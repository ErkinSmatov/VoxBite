/**
 * npm run index-fdc — the offline USDA FDC indexing pipeline entrypoint.
 *
 * Order of operations: parse -> resolve nutrients -> filter (isIndexable)
 * -> skip already-indexed (dataset+model version match) -> print cost
 * estimate -> embed -> upsert -> final coverage report.
 *
 * D-03 (owner runs this by hand, alone): every step prints what it
 * completed before the next one starts, and any error's closing message
 * tells the owner the exact command to re-run — a half-finished run is
 * always safe to resume because the loader upserts on fdc_id and skips
 * rows whose dataset+model version already match (see load.ts).
 *
 * Never wraps the whole run in one transaction — partial progress
 * surviving a crash is the point, not a bug.
 */
import { sql } from 'drizzle-orm';
import { createDb, closeDb } from '../../src/db/client.js';
import { fdcFoods } from '../../src/db/schema/fdc-foods.js';
import {
  createOpenAIEmbedder,
  estimateEmbeddingCostUsd,
} from '../../src/adapters/embeddings/openai-embed.js';
import { EMBEDDING_BATCH_SIZE, EMBEDDING_MODEL } from '../../src/adapters/embeddings/types.js';
import { FDC_DATASETS, resolveExtractedCsvPaths, type FdcDataset } from './datasets.js';
import { parseFoundationFoods } from './parse-foundation.js';
import { parseSrLegacyFoods } from './parse-sr-legacy.js';
import { buildNutrientIndex, resolveFoodNutrients } from './resolve-nutrients.js';
import { isIndexable, loadExistingVersions, upsertFdcFoods, type IndexableRecord } from './load.js';
import { buildEmbeddings } from './build-embeddings.js';
import type { NewFdcFood } from '../../src/db/schema/fdc-foods.js';

/** MATCH-02 tripwire: a healthy Foundation Foods kept-count is ~469. If the
 * data_type filter regresses, thousands of Branded-style rows would slip
 * into the index — abort loudly instead of silently indexing them. */
const FOUNDATION_KEPT_SANITY_LIMIT = 5000;

/** The only accepted `--source=` values. Anything else is a typo and must
 * stop the run: a silent fallback here would embed the WRONG dataset and
 * spend real money doing it (7 793 строки SR Legacy вместо 469 Foundation). */
export const VALID_SOURCES = ['foundation', 'sr-legacy', 'both'] as const;
export type SourceOption = (typeof VALID_SOURCES)[number];

/** Ошибка в самой команде (опечатка во флаге), а не сбой прогона. Отличается
 * от обычной ошибки, чтобы не советовать «просто перезапусти» там, где надо
 * сначала исправить команду. */
export class UsageError extends Error {
  readonly isUsageError = true;
}

export interface RunOptions {
  limit?: number;
  source: SourceOption;
  force: boolean;
  dryRun: boolean;
}

/** Everything after the first `=` — так значение, внутри которого есть `=`,
 * не обрежется молча, как это делал `split('=')[1]`. */
function flagValue(arg: string): string {
  const eq = arg.indexOf('=');
  return eq === -1 ? '' : arg.slice(eq + 1);
}

function parseSource(raw: string | undefined): SourceOption {
  if (raw === undefined) {
    return 'both';
  }
  if ((VALID_SOURCES as readonly string[]).includes(raw)) {
    return raw as SourceOption;
  }
  throw new UsageError(
    `Не понимаю значение --source="${raw}". ` +
      `Допустимые значения (пиши ровно так, маленькими буквами): ${VALID_SOURCES.join(', ')}. ` +
      `Например: npm run index-fdc -- --source=foundation`,
  );
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  // Number('') === 0 и Number('  ') === 0 в JS — пустое значение надо
  // отсечь явно, иначе `--limit=` молча превратится в 0 и скрипт «успешно»
  // не проиндексирует ничего.
  const value = trimmed.length > 0 ? Number(trimmed) : NaN;
  if (!Number.isInteger(value) || value < 1) {
    throw new UsageError(
      `Не понимаю значение --limit="${raw}". ` +
        `Нужно целое число не меньше 1 (сколько записей взять для пробного прогона). ` +
        `Например: npm run index-fdc -- --limit=10 --dry-run`,
    );
  }
  return value;
}

export function parseArgs(argv: string[]): RunOptions {
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const sourceArg = argv.find((a) => a.startsWith('--source='));
  return {
    limit: parseLimit(limitArg === undefined ? undefined : flagValue(limitArg)),
    source: parseSource(sourceArg === undefined ? undefined : flagValue(sourceArg)),
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
  };
}

export function selectedDatasets(opts: RunOptions): FdcDataset[] {
  return FDC_DATASETS.filter((ds) => {
    if (opts.source === 'both') return true;
    if (opts.source === 'foundation') return ds.source === 'foundation_food';
    if (opts.source === 'sr-legacy') return ds.source === 'sr_legacy_food';
    // Недостижимо: parseSource уже отверг всё остальное. Оставлено, чтобы
    // новое значение в VALID_SOURCES не начало молча выбирать SR Legacy.
    throw new Error(`Необработанное значение --source: "${String(opts.source)}"`);
  });
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const datasets = selectedDatasets(opts);

  console.log('=== npm run index-fdc ===');
  console.log(
    `Опции: source=${opts.source}${opts.limit !== undefined ? `, limit=${opts.limit}` : ''}` +
      `${opts.force ? ', force=true' : ''}${opts.dryRun ? ', dry-run=true' : ''}`,
  );

  // --- Step 1: verify CSVs exist ---------------------------------------
  console.log('\n--- Шаг 1: проверка файлов ---');
  const resolvedPaths = new Map<FdcDataset, { foodCsv: string; foodNutrientCsv: string }>();
  for (const ds of datasets) {
    const { foodCsv, foodNutrientCsv } = resolveExtractedCsvPaths(ds);
    if (!foodCsv || !foodNutrientCsv) {
      console.error(
        `Файлы для ${ds.source} не найдены в ${ds.extractDir}. ` +
          `Сначала запусти \`npm run fdc:download\`.`,
      );
      process.exit(1);
      return;
    }
    resolvedPaths.set(ds, { foodCsv, foodNutrientCsv });
  }
  console.log('Все нужные CSV-файлы найдены.');

  // --- Step 2: parse food.csv per dataset -------------------------------
  console.log('\n--- Шаг 2: разбор food.csv ---');
  let allKept: IndexableRecord[] = [];
  const wantedFdcIds = new Set<number>();
  const perDataset = new Map<FdcDataset, { fdcId: number; description: string }[]>();

  for (const ds of datasets) {
    const paths = resolvedPaths.get(ds);
    if (!paths) continue;
    const result =
      ds.source === 'foundation_food'
        ? await parseFoundationFoods(paths.foodCsv)
        : await parseSrLegacyFoods(paths.foodCsv);

    const label = ds.source === 'foundation_food' ? 'Foundation Foods' : 'SR Legacy';
    console.log(
      `${label}: ${fmtCount(result.totalRows)} rows -> ${fmtCount(result.keptRows)} kept ` +
        `(data_type=${ds.source})`,
    );
    if (Object.keys(result.skippedByDataType).length > 0) {
      for (const [dataType, count] of Object.entries(result.skippedByDataType)) {
        console.log(`  пропущено ${dataType}: ${fmtCount(count)}`);
      }
    }

    if (ds.source === 'foundation_food' && result.keptRows > FOUNDATION_KEPT_SANITY_LIMIT) {
      throw new Error(
        `фильтр data_type сломан — в индекс попадут брендовые записи, см. 01-RESEARCH.md ` +
          `Pattern 2 (Foundation kept-count ${result.keptRows} > ${FOUNDATION_KEPT_SANITY_LIMIT})`,
      );
    }

    let kept = result.foods;
    if (opts.limit !== undefined) {
      kept = kept.slice(0, opts.limit);
    }
    perDataset.set(ds, kept.map((f) => ({ fdcId: f.fdcId, description: f.description })));
    for (const f of kept) {
      wantedFdcIds.add(f.fdcId);
    }
  }

  // --- Step 3: resolve nutrients -----------------------------------------
  console.log('\n--- Шаг 3: сопоставление нутриентов ---');
  const nutrientsByFdcId = new Map<number, ReturnType<typeof resolveFoodNutrients>>();
  let totalDuplicateCount = 0;
  let totalUnparsableAmountCount = 0;
  let atwaterFallbackCount = 0;

  for (const ds of datasets) {
    const paths = resolvedPaths.get(ds);
    const foods = perDataset.get(ds);
    if (!paths || !foods) continue;
    const idsForDataset = new Set(foods.map((f) => f.fdcId));
    const { index, duplicateCount, unparsableAmountCount } = await buildNutrientIndex(
      paths.foodNutrientCsv,
      idsForDataset,
    );
    totalDuplicateCount += duplicateCount;
    totalUnparsableAmountCount += unparsableAmountCount;

    for (const food of foods) {
      const nutrients = resolveFoodNutrients(index.get(food.fdcId));
      if (nutrients.kcalDerived) {
        atwaterFallbackCount += 1;
      }
      nutrientsByFdcId.set(food.fdcId, nutrients);
    }
  }
  console.log(
    `duplicateCount=${fmtCount(totalDuplicateCount)}, ` +
      `unparsableAmountCount=${fmtCount(totalUnparsableAmountCount)}, ` +
      `kcal рассчитан по формуле Atwater для ${fmtCount(atwaterFallbackCount)} записей`,
  );

  // --- Step 4: apply isIndexable ------------------------------------------
  console.log('\n--- Шаг 4: фильтр «нет данных для расчёта» ---');
  const allCandidates: IndexableRecord[] = [];
  for (const ds of datasets) {
    const foods = perDataset.get(ds);
    if (!foods) continue;
    for (const food of foods) {
      const nutrients = nutrientsByFdcId.get(food.fdcId) ?? {
        kcal: null,
        proteinG: null,
        fatG: null,
        carbsG: null,
        sugarG: null,
      };
      allCandidates.push({
        fdcId: food.fdcId,
        description: food.description,
        source: ds.source,
        kcal: nutrients.kcal,
        proteinG: nutrients.proteinG,
        fatG: nutrients.fatG,
        carbsG: nutrients.carbsG,
        sugarG: nutrients.sugarG,
      });
    }
  }

  const excluded = allCandidates.filter((r) => !isIndexable(r));
  allKept = allCandidates.filter((r) => isIndexable(r));
  console.log(`Исключено записей без белков/жиров/углеводов: ${fmtCount(excluded.length)}`);
  for (const r of excluded.slice(0, 50)) {
    console.log(`  fdcId=${r.fdcId}: ${r.description}`);
  }
  if (excluded.length > 50) {
    console.log(`  ... и ещё ${fmtCount(excluded.length - 50)}`);
  }

  // --- Steps 5-9: everything that touches the database happens here, in a
  // try/finally so the connection is always closed — never wrapped in a
  // single transaction, so partial progress (Step 8's upsert already
  // happened) survives even if a later step throws (D-03).
  const db = createDb();
  try {
    console.log('\n--- Шаг 5: пропуск уже проиндексированных записей ---');
    const existingVersions = await loadExistingVersions(db);

    let toProcess = allKept;
    if (!opts.force) {
      const before = toProcess.length;
      toProcess = toProcess.filter((r) => {
        const existing = existingVersions.get(r.fdcId);
        const ds = FDC_DATASETS.find((d) => d.source === r.source);
        const currentDatasetVersion = ds?.datasetVersion ?? '';
        const alreadyCurrent =
          existing !== undefined &&
          existing.datasetVersion === currentDatasetVersion &&
          existing.embeddingModelVersion === EMBEDDING_MODEL;
        return !alreadyCurrent;
      });
      console.log(
        `${fmtCount(before - toProcess.length)} уже проиндексировано, пропускаем ` +
          `(используй --force чтобы переиндексировать)`,
      );
    } else {
      console.log('--force: переиндексируем все записи заново.');
    }

    // --- Step 6: cost estimate before spending anything -------------------
    console.log('\n--- Шаг 6: оценка стоимости ---');
    const texts = toProcess.map((r) => r.description);
    const estimatedCostUsd = estimateEmbeddingCostUsd(texts);
    const callCount = Math.ceil(texts.length / EMBEDDING_BATCH_SIZE);
    console.log(
      `Будет отправлено ${fmtCount(texts.length)} записей на эмбеддинг ` +
        `(${fmtCount(callCount)} запрос(ов) к OpenAI). Примерная стоимость: $${estimatedCostUsd.toFixed(4)}.`,
    );

    if (opts.dryRun) {
      console.log('\n--dry-run: остановка здесь, ничего не отправлено в OpenAI и не записано в базу.');
      return;
    }

    if (texts.length === 0) {
      console.log('Нечего индексировать — все записи уже актуальны.');
      await printFinalReport(db);
      return;
    }

    // --- Step 7: embed with progress ---------------------------------------
    console.log('\n--- Шаг 7: получение эмбеддингов ---');
    const embedder = createOpenAIEmbedder();
    const embedded = await buildEmbeddings(embedder, toProcess, (done, total, batchIndex, batchCount) => {
      console.log(`batch ${batchIndex}/${batchCount}, ${fmtCount(done)}/${fmtCount(total)} записей`);
    });

    // --- Step 8: upsert ------------------------------------------------------
    console.log('\n--- Шаг 8: запись в базу данных ---');
    const rows: NewFdcFood[] = embedded.map(({ record, embedding }) => {
      const ds = FDC_DATASETS.find((d) => d.source === record.source);
      return {
        fdcId: record.fdcId,
        description: record.description,
        source: record.source,
        kcal: record.kcal,
        proteinG: record.proteinG,
        fatG: record.fatG,
        carbsG: record.carbsG,
        sugarG: record.sugarG,
        embedding,
        datasetVersion: ds?.datasetVersion ?? 'unknown',
        embeddingModelVersion: EMBEDDING_MODEL,
      };
    });
    const written = await upsertFdcFoods(db, rows);
    console.log(`Записано/обновлено строк: ${fmtCount(written)}`);

    // --- Step 9: final report ------------------------------------------------
    await printFinalReport(db);
  } finally {
    await closeDb();
  }
}

async function printFinalReport(db: ReturnType<typeof createDb>): Promise<void> {
  console.log('\n--- Итог ---');
  const bySource = await db
    .select({ source: fdcFoods.source, count: sql<number>`count(*)` })
    .from(fdcFoods)
    .groupBy(fdcFoods.source);

  const totalRow = await db.execute<{
    total: number;
    kcal_count: number;
    protein_count: number;
    fat_count: number;
    carbs_count: number;
    sugar_count: number;
  }>(sql`
    select
      count(*)::int as total,
      count(kcal)::int as kcal_count,
      count(protein_g)::int as protein_count,
      count(fat_g)::int as fat_count,
      count(carbs_g)::int as carbs_count,
      count(sugar_g)::int as sugar_count
    from fdc_foods
  `);

  const totals = totalRow[0] as
    | {
        total: number;
        kcal_count: number;
        protein_count: number;
        fat_count: number;
        carbs_count: number;
        sugar_count: number;
      }
    | undefined;

  const total = totals?.total ?? 0;
  console.log(`Всего записей в fdc_foods: ${fmtCount(total)}`);
  for (const row of bySource) {
    console.log(`  ${row.source}: ${fmtCount(Number(row.count))}`);
  }

  if (total > 0 && totals) {
    const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
    console.log(
      `Покрытие по полям: kcal ${pct(totals.kcal_count)}, protein ${pct(totals.protein_count)}, ` +
        `fat ${pct(totals.fat_count)}, carbs ${pct(totals.carbs_count)}, sugar ${pct(totals.sugar_count)}`,
    );
    console.log(
      'Неполное покрытие sugar — это ожидаемо и корректно: отсутствующий сахар хранится ' +
        'как NULL и будет показан пользователю как «нет данных», а не как 0 (TECH_SPEC §5.8).',
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`\n[ОШИБКА] ${err instanceof Error ? err.message : String(err)}`);
      if (!(err instanceof UsageError)) {
        console.error(
          '\nСкрипт безопасно перезапускается: `npm run index-fdc` — записи, которые уже ' +
            'успели записаться в базу, будут пропущены (эмбеддинги за них второй раз не оплатятся).',
        );
      }
      process.exit(1);
    });
}
