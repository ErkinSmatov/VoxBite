/**
 * verify-index.ts
 *
 * Проверяет содержимое таблицы `fdc_foods` ПОСЛЕ того, как `npm run index-fdc`
 * записал в неё реальные данные. Это последняя линия защиты MATCH-02
 * ("только реальные записи из Foundation Foods / SR Legacy, ничего
 * брендового") и TECH_SPEC §5.8 (сахар без данных хранится как NULL, а не
 * как 0).
 *
 * Запускается командой: npm run verify-index
 * Флаг --json печатает тот же результат в виде JSON.
 *
 * Как и verify-schema.ts, здесь используется формат вывода [ok]/[FAIL] с
 * понятным объяснением каждой проверки и без утечки строки подключения к
 * базе данных (печатается только хост:порт).
 */
import postgres from 'postgres';
import { loadEnv } from '../../src/config/env.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  remediation?: string;
}

const results: CheckResult[] = [];

function argvHas(flag: string): boolean {
  return process.argv.includes(flag);
}

function maskConnectionTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}`;
  } catch {
    return '(не удалось разобрать адрес подключения)';
  }
}

function record(name: string, ok: boolean, detail: string, remediation?: string): void {
  results.push({ name, ok, detail, remediation });
  const label = ok ? '[ok]' : '[FAIL]';
  console.log(`${label} ${name} — ${detail}`);
}

const ROW_COUNT_MIN = 7_900;
const ROW_COUNT_MAX = 8_400;
const FOUNDATION_MIN = 380;
const FOUNDATION_MAX = 500;
const SR_LEGACY_MIN = 7_500;
const SR_LEGACY_MAX = 7_900;
const EXPECTED_EMBEDDING_MODEL = 'text-embedding-3-small';
const EXPECTED_DIMENSIONS = 1536;

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

async function checkRowCount(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ count: string }[]>`select count(*)::text as count from fdc_foods`;
  const total = Number(rows[0]?.count ?? 0);
  const ok = total >= ROW_COUNT_MIN && total <= ROW_COUNT_MAX;
  if (ok) {
    record(
      'Общее число записей',
      true,
      `${fmt(total)} строк — в ожидаемом диапазоне ${fmt(ROW_COUNT_MIN)}-${fmt(ROW_COUNT_MAX)} ` +
        '(469 Foundation Foods + 7,793 SR Legacy, минус записи без белков/жиров/углеводов)',
    );
  } else if (total < ROW_COUNT_MIN) {
    record(
      'Общее число записей',
      false,
      `${fmt(total)} строк — меньше ожидаемого диапазона ${fmt(ROW_COUNT_MIN)}-${fmt(ROW_COUNT_MAX)}, похоже на неполную загрузку`,
      'Запусти `npm run index-fdc` ещё раз — уже загруженные записи будут пропущены, догрузятся только недостающие',
    );
  } else {
    record(
      'Общее число записей',
      false,
      `${fmt(total)} строк — больше ожидаемого диапазона ${fmt(ROW_COUNT_MIN)}-${fmt(ROW_COUNT_MAX)}, похоже, фильтр data_type сломан`,
      'См. 01-RESEARCH.md Pattern 2 — Foundation Foods должен фильтроваться по data_type=foundation_food',
    );
  }
}

async function checkSourceValues(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ source: string; count: string }[]>`
    select source, count(*)::text as count from fdc_foods group by source
  `;
  const bySource = new Map(rows.map((r) => [r.source, Number(r.count)]));
  const allowed = new Set(['foundation_food', 'sr_legacy_food']);
  const unexpected = [...bySource.keys()].filter((s) => !allowed.has(s));

  if (unexpected.length > 0) {
    record(
      'Значения source',
      false,
      `найден неожиданный source: ${unexpected.join(', ')} — в таблице должны быть только foundation_food и sr_legacy_food`,
      'Проверь, откуда взялась строка с этим source — MATCH-02 запрещает любые данные, кроме Foundation Foods и SR Legacy',
    );
    return;
  }

  const foundationCount = bySource.get('foundation_food') ?? 0;
  const srLegacyCount = bySource.get('sr_legacy_food') ?? 0;
  const foundationOk = foundationCount >= FOUNDATION_MIN && foundationCount <= FOUNDATION_MAX;
  const srLegacyOk = srLegacyCount >= SR_LEGACY_MIN && srLegacyCount <= SR_LEGACY_MAX;

  if (foundationOk && srLegacyOk) {
    record(
      'Значения source',
      true,
      `только foundation_food (${fmt(foundationCount)}, ожидалось ${FOUNDATION_MIN}-${FOUNDATION_MAX}) и ` +
        `sr_legacy_food (${fmt(srLegacyCount)}, ожидалось ${SR_LEGACY_MIN}-${SR_LEGACY_MAX})`,
    );
  } else {
    record(
      'Значения source',
      false,
      `foundation_food=${fmt(foundationCount)} (ожидалось ${FOUNDATION_MIN}-${FOUNDATION_MAX}), ` +
        `sr_legacy_food=${fmt(srLegacyCount)} (ожидалось ${SR_LEGACY_MIN}-${SR_LEGACY_MAX})`,
      'Один из датасетов загрузился не полностью или фильтр data_type сломан — см. 01-RESEARCH.md Pattern 2',
    );
  }
}

// A small number of brand-named entries legitimately exist in the official
// SR Legacy dataset (data_type=sr_legacy_food) — e.g. "Candies, NESTLE,
// BUTTERFINGER Bar" — because SR Legacy is USDA's own curated reference
// database, and 01-RESEARCH.md documents it as "7,793 rows, all kept" with
// no data_type filtering. This is NOT the failure mode MATCH-02 guards
// against: that's Branded Foods (a separate, unfiltered ~2M-row retail-label
// scan dataset that was never even downloaded) or a regressed Foundation
// Foods data_type filter (which would let thousands of unfiltered rows in).
// The meaningful signal for a real MATCH-02 violation is therefore: (a) any
// brand-named match coming from `foundation_food` (which IS filtered and
// should never contain one), or (b) a match count so large it implies the
// data_type filter stopped working entirely.
const BRAND_MATCH_SANITY_LIMIT = 200;

async function checkBrandPollution(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ fdc_id: number; source: string; description: string }[]>`
    select fdc_id, source, description from fdc_foods
    where description ilike '%sabra%'
       or description ilike '%kellogg%'
       or description ilike '%nestle%'
       or description ilike '%, brand%'
  `;
  const fromFoundation = rows.filter((r) => r.source === 'foundation_food');

  if (rows.length === 0) {
    record(
      'Проверка на бренды (MATCH-02)',
      true,
      'ни одна запись не похожа на брендовый розничный продукт (напр. "HUMMUS, SABRA CLASSIC")',
    );
  } else if (fromFoundation.length > 0) {
    record(
      'Проверка на бренды (MATCH-02)',
      false,
      `${fromFoundation.length} подозрительных записей взяты из foundation_food (должен быть отфильтрован): ` +
        fromFoundation
          .slice(0, 10)
          .map((r) => `fdcId=${r.fdc_id} "${r.description}"`)
          .join('; '),
      'Foundation Foods data_type-фильтр пропустил брендовую запись — проверь parse-foundation.ts',
    );
  } else if (rows.length > BRAND_MATCH_SANITY_LIMIT) {
    record(
      'Проверка на бренды (MATCH-02)',
      false,
      `${rows.length} подозрительных записей (> ${BRAND_MATCH_SANITY_LIMIT}) — похоже, что фильтр перестал работать`,
      'Проверь фильтр data_type в parse-sr-legacy.ts — SR Legacy не должен содержать столько брендовых записей',
    );
  } else {
    record(
      'Проверка на бренды (MATCH-02)',
      true,
      `найдено ${rows.length} записей с брендовым словом (${fromFoundation.length} из foundation_food), ` +
        'все из sr_legacy_food — это ожидаемо: USDA SR Legacy — официальный curated-датасет и по замыслу ' +
        'загружается без фильтрации (01-RESEARCH.md: "7,793 rows, all kept"), в отличие от Branded Foods ' +
        '(отдельный ~2 млн строк датасет розничных сканов этикеток, который вообще не скачивается)',
    );
  }
}

async function checkEmbeddings(sql: postgres.Sql): Promise<void> {
  const nullRows = await sql<{ count: string }[]>`
    select count(*)::text as count from fdc_foods where embedding is null
  `;
  const nullCount = Number(nullRows[0]?.count ?? 0);

  const dimRows = await sql<{ min_dims: number | null; max_dims: number | null }[]>`
    select min(vector_dims(embedding)) as min_dims, max(vector_dims(embedding)) as max_dims
    from fdc_foods
  `;
  const minDims = dimRows[0]?.min_dims ?? null;
  const maxDims = dimRows[0]?.max_dims ?? null;

  const dimsOk = minDims === EXPECTED_DIMENSIONS && maxDims === EXPECTED_DIMENSIONS;

  if (nullCount === 0 && dimsOk) {
    record(
      'Целостность эмбеддингов',
      true,
      `нет NULL-эмбеддингов, у всех записей ровно ${EXPECTED_DIMENSIONS} измерений (min=${minDims}, max=${maxDims})`,
    );
  } else if (nullCount > 0) {
    record(
      'Целостность эмбеддингов',
      false,
      `${fmt(nullCount)} записей без эмбеддинга (embedding is null)`,
      'Запусти `npm run index-fdc` ещё раз — эти записи должны догрузиться',
    );
  } else {
    record(
      'Целостность эмбеддингов',
      false,
      `размерность эмбеддингов непостоянна: min=${minDims}, max=${maxDims}, ожидалось ${EXPECTED_DIMENSIONS} для всех`,
      'Похоже, часть записей проиндексирована другой моделью эмбеддингов — проверь embedding_model_version',
    );
  }
}

interface CoverageRow {
  source: string;
  total: string;
  kcal_count: string;
  protein_count: string;
  fat_count: string;
  carbs_count: string;
  sugar_count: string;
}

async function checkNutrientCoverage(sql: postgres.Sql): Promise<void> {
  const rows = await sql<CoverageRow[]>`
    select
      source,
      count(*)::text as total,
      count(kcal)::text as kcal_count,
      count(protein_g)::text as protein_count,
      count(fat_g)::text as fat_count,
      count(carbs_g)::text as carbs_count,
      count(sugar_g)::text as sugar_count
    from fdc_foods
    group by source
  `;

  const overallRows = await sql<CoverageRow[]>`
    select
      'overall' as source,
      count(*)::text as total,
      count(kcal)::text as kcal_count,
      count(protein_g)::text as protein_count,
      count(fat_g)::text as fat_count,
      count(carbs_g)::text as carbs_count,
      count(sugar_g)::text as sugar_count
    from fdc_foods
  `;

  const pct = (n: number, total: number) => (total > 0 ? `${((n / total) * 100).toFixed(1)}%` : 'n/a');

  console.log('\nПокрытие полей по источнику (доля записей с непустым значением):');
  console.log('source          total   kcal    protein  fat      carbs    sugar');
  for (const r of [...rows, ...overallRows]) {
    const total = Number(r.total);
    console.log(
      `${r.source.padEnd(15)} ${fmt(total).padStart(6)}  ` +
        `${pct(Number(r.kcal_count), total).padStart(6)}  ` +
        `${pct(Number(r.protein_count), total).padStart(7)}  ` +
        `${pct(Number(r.fat_count), total).padStart(7)}  ` +
        `${pct(Number(r.carbs_count), total).padStart(7)}  ` +
        `${pct(Number(r.sugar_count), total).padStart(6)}`,
    );
  }

  const overall = overallRows[0];
  const overallTotal = Number(overall?.total ?? 0);
  const proteinCoverage = overallTotal > 0 ? Number(overall?.protein_count ?? 0) / overallTotal : 0;
  const sugarCoverage = overallTotal > 0 ? Number(overall?.sugar_count ?? 0) / overallTotal : 0;

  const proteinOk = proteinCoverage > 0.9;
  if (proteinOk) {
    record(
      'Покрытие protein_g',
      true,
      `${(proteinCoverage * 100).toFixed(1)}% записей содержат protein_g (> 90%)`,
    );
  } else {
    record(
      'Покрытие protein_g',
      false,
      `только ${(proteinCoverage * 100).toFixed(1)}% записей содержат protein_g (ожидалось > 90%)`,
      'Резкое падение покрытия белка означает, что сопоставление нутриентов (resolve-nutrients.ts) сломано',
    );
  }

  const sugarOk = sugarCoverage > 0 && sugarCoverage < 1;
  if (sugarOk) {
    record(
      'Покрытие sugar_g',
      true,
      `${(sugarCoverage * 100).toFixed(1)}% записей содержат sugar_g — часть данных есть, часть отсутствует (NULL), это ожидаемо. ` +
        'NULL — это корректное состояние: пользователь увидит «нет данных», а не 0 г сахара (TECH_SPEC §5.8)',
    );
  } else if (sugarCoverage === 0) {
    record(
      'Покрытие sugar_g',
      false,
      'ни одна запись не содержит sugar_g (0%) — сопоставление нутриентов для сахара сломано',
      'Проверь resolve-nutrients.ts — sugar (nutrient id 269/2000) должен резолвиться хотя бы для части записей',
    );
  } else {
    record(
      'Покрытие sugar_g',
      false,
      'у всех записей есть sugar_g (100%) — подозрительно, похоже что отсутствующий сахар подменяется значением вместо NULL',
      'Найди место, где sugarG приводится к 0 вместо null (TECH_SPEC §5.8 требует хранить «нет данных» как NULL)',
    );
  }
}

async function checkZeroVsNullSugar(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ null_count: string; zero_count: string }[]>`
    select
      count(*) filter (where sugar_g is null)::text as null_count,
      count(*) filter (where sugar_g = 0)::text as zero_count
    from fdc_foods
  `;
  const nullCount = Number(rows[0]?.null_count ?? 0);
  const zeroCount = Number(rows[0]?.zero_count ?? 0);
  const total = nullCount + zeroCount; // not the true grand total, just these two buckets

  // A real "0 г сахара" is a legitimate, common lab result (raw meats, oils,
  // etc. genuinely contain no sugar) — SR Legacy is meat-heavy, so a large
  // zero-count is expected and is NOT evidence of a bug on its own. The
  // actual regression this guards against is NULL silently collapsing to
  // near-zero (i.e. "no data" being coalesced to "0 data"), which would show
  // up as nullCount being suspiciously small relative to the total rows that
  // have EITHER a NULL or a real 0 sugar value.
  const nullShareOfNullOrZero = total > 0 ? nullCount / total : 0;
  const ok = nullCount > 0 && nullShareOfNullOrZero > 0.05;

  if (ok) {
    record(
      'sugar_g: NULL против 0',
      true,
      `NULL (нет данных): ${fmt(nullCount)}, ровно 0 г (реальное измерение, напр. сырое мясо): ${fmt(zeroCount)} — ` +
        'NULL присутствует в заметном количестве, значит не подменяется нулём',
    );
  } else {
    record(
      'sugar_g: NULL против 0',
      false,
      `NULL: ${fmt(nullCount)}, = 0: ${fmt(zeroCount)} — NULL почти отсутствует на фоне записей с 0 г, ` +
        'похоже что отсутствующий сахар подменяется нулём',
      'Найди место, где sugarG приводится к 0 вместо null (TECH_SPEC §5.8)',
    );
  }
}

async function checkVersionStamping(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ dataset_version: string; embedding_model_version: string; count: string }[]>`
    select dataset_version, embedding_model_version, count(*)::text as count
    from fdc_foods
    group by dataset_version, embedding_model_version
    order by dataset_version
  `;

  const distinctModels = new Set(rows.map((r) => r.embedding_model_version));
  const modelsOk = distinctModels.size === 1 && distinctModels.has(EXPECTED_EMBEDDING_MODEL);

  const pairsList = rows
    .map((r) => `${r.dataset_version}/${r.embedding_model_version} (${fmt(Number(r.count))})`)
    .join(', ');

  if (modelsOk) {
    record(
      'Версии датасета и модели эмбеддингов',
      true,
      `все записи используют модель ${EXPECTED_EMBEDDING_MODEL}. Пары dataset_version/embedding_model_version: ${pairsList}`,
    );
  } else {
    record(
      'Версии датасета и модели эмбеддингов',
      false,
      `найдено больше одной модели эмбеддингов в таблице: ${[...distinctModels].join(', ')} — смешанные векторные пространства ломают HNSW-поиск`,
      'Переиндексируй таблицу с --force одной моделью эмбеддингов, чтобы все векторы были совместимы',
    );
  }
}

interface SampleRow {
  fdc_id: number;
  source: string;
  description: string;
  kcal: number | null;
  sugar_g: number | null;
}

async function printSampleRows(sql: postgres.Sql): Promise<void> {
  const rows = await sql<SampleRow[]>`
    select fdc_id, source, description, kcal, sugar_g
    from fdc_foods
    order by random()
    limit 5
  `;
  console.log('\nСлучайные 5 записей (для проверки глазами, без Supabase Dashboard):');
  for (const r of rows) {
    const sugar = r.sugar_g === null ? 'нет данных' : `${r.sugar_g} г`;
    console.log(`  fdcId=${r.fdc_id} [${r.source}] "${r.description}" — kcal=${r.kcal ?? 'нет данных'}, sugar=${sugar}`);
  }
}

interface JsonOutput {
  ok: boolean;
  checks: CheckResult[];
}

async function main(): Promise<void> {
  const jsonMode = argvHas('--json');
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const connectionTarget = maskConnectionTarget(env.DATABASE_URL);
  if (!jsonMode) {
    console.log(`\nПроверка загруженного индекса fdc_foods (${connectionTarget})...\n`);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await checkRowCount(sql);
    await checkSourceValues(sql);
    await checkBrandPollution(sql);
    await checkEmbeddings(sql);
    await checkNutrientCoverage(sql);
    await checkZeroVsNullSugar(sql);
    await checkVersionStamping(sql);
    if (!jsonMode) {
      await printSampleRows(sql);
    }
  } finally {
    await sql.end();
  }

  const allOk = results.every((r) => r.ok);

  if (jsonMode) {
    const output: JsonOutput = { ok: allOk, checks: results };
    console.log(JSON.stringify(output, null, 2));
  } else if (allOk) {
    console.log('\nINDEX OK');
  } else {
    console.log('\nИндекс fdc_foods не прошёл проверку. Что делать:');
    let i = 1;
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`${i}. ${r.name}: ${r.remediation ?? 'см. сообщение выше'}`);
      i += 1;
    }
  }

  process.exit(allOk ? 0 : 1);
}

main();
