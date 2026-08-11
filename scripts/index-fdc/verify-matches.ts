/**
 * verify-matches.ts
 *
 * Scripted check + owner-readable report for Phase 1 success criterion #4:
 * "a scripted query returns 3 plausible FDC candidates for 10 hand-picked
 * English ingredient names, with no candidate from Branded Foods." This is
 * the concrete, mechanical half of "plausible" — the owner's own eyeball
 * verdict (checkpoint:human-verify in 01-08-PLAN.md Task 3) is the other
 * half a script cannot judge.
 *
 * Runs the real chain: OpenAI embeddings -> matchIngredient() ->
 * createDrizzleFdcRepository() -> live pgvector HNSW search against the
 * populated fdc_foods table.
 *
 * Запускается командой: npm run verify-matches
 * Флаг --json печатает результат в виде JSON.
 */
import { createDb, closeDb } from '../../src/db/client.js';
import { createOpenAIEmbedder } from '../../src/adapters/embeddings/openai-embed.js';
import { estimateEmbeddingCostUsd } from '../../src/adapters/embeddings/openai-embed.js';
import { createDrizzleFdcRepository } from '../../src/adapters/fdc-repository.js';
import { matchIngredient } from '../../src/domain/fdc-matching/match-ingredient.js';
import { ALLOWED_SOURCES } from '../../src/domain/fdc-matching/types.js';
import type { FdcCandidate } from '../../src/domain/fdc-matching/types.js';

// Chosen so at least three are raw/cooked-ambiguous per 01-RESEARCH.md
// Pitfall 5 (chicken breast, ground beef, white rice).
const CHECK_NAMES = [
  'chicken breast',
  'ground beef',
  'white rice',
  'banana',
  'kale',
  'whole milk',
  'olive oil',
  'chicken egg',
  'rolled oats',
  'cheddar cheese',
] as const;

const BRAND_PROBE = /sabra|kellogg|nestle/i;
const NEAR_DUPLICATE_SIMILARITY_DELTA = 0.01;

interface NameResult {
  name: string;
  candidates: FdcCandidate[];
}

interface Failure {
  message: string;
  remediation: string;
}

function argvHas(flag: string): boolean {
  return process.argv.includes(flag);
}

function sugarLabel(sugarG: number | null): string {
  return sugarG === null ? 'нет данных' : `${sugarG} г`;
}

function printBlock(result: NameResult): void {
  console.log(`\n"${result.name}"`);
  result.candidates.forEach((c, i) => {
    console.log(
      `  ${i + 1}. sim=${c.similarity.toFixed(3)} [${c.source}] fdcId=${c.fdcId} "${c.description}" ` +
        `— kcal=${c.kcal ?? 'нет данных'}, sugar=${sugarLabel(c.sugarG)}`,
    );
  });

  // Non-failing warning: near-duplicate candidates (same fdcId prefix, or
  // pairwise similarity differences below the threshold) — 01-RESEARCH.md
  // Pitfall 6: out of scope to fix in this phase, worth carrying to Phase 4.
  const sims = result.candidates.map((c) => c.similarity).sort((a, b) => b - a);
  const closePairs = sims.some((s, i) => i > 0 && Math.abs(s - (sims[i - 1] as number)) < NEAR_DUPLICATE_SIMILARITY_DELTA);
  const descriptions = result.candidates.map((c) => c.description.split(',')[0]?.trim().toLowerCase());
  const sameLeadWord = new Set(descriptions).size < descriptions.length;
  if (closePairs || sameLeadWord) {
    console.log(
      '  WARNING: candidates look like near-duplicates (similar scores or repeated lead word) — ' +
        'accepted for this phase per 01-RESEARCH.md Pitfall 6, carry to Phase 4.',
    );
  }
}

async function main(): Promise<void> {
  const jsonMode = argvHas('--json');
  const failures: Failure[] = [];
  const results: NameResult[] = [];

  const embedder = createOpenAIEmbedder();
  const names = [...CHECK_NAMES];
  const estimatedCost = estimateEmbeddingCostUsd(names);
  if (!jsonMode) {
    console.log(`\n=== npm run verify-matches ===`);
    console.log(`Эмбеддинг ${names.length} названий одним batched-запросом. Примерная стоимость: $${estimatedCost.toFixed(6)}.`);
  }

  const db = createDb();
  try {
    let embeddings: number[][] = [];
    try {
      embeddings = await embedder.embed(names);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({
        message: `Не удалось получить эмбеддинги: ${message}`,
        remediation: message.includes('429') || message.includes('quota')
          ? 'Проверь баланс OpenAI, см. план 01-02'
          : 'Проверь OPENAI_API_KEY в .env и подключение к сети',
      });
    }

    const repo = createDrizzleFdcRepository(db);

    for (let i = 0; embeddings.length > 0 && i < names.length; i += 1) {
      const name = names[i] as string;
      const embedding = embeddings[i] as number[];
      let candidates: FdcCandidate[];
      try {
        candidates = await matchIngredient({ embedding, repo });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push({
          message: `"${name}": matchIngredient упал — ${message}`,
          remediation: message.includes('dimension')
            ? 'Индекс построен с другой моделью эмбеддингов — переиндексируй с --force'
            : 'Проверь подключение к базе данных',
        });
        continue;
      }

      results.push({ name, candidates });

      if (candidates.length === 0) {
        failures.push({
          message: `"${name}": вернулось 0 кандидатов`,
          remediation: 'Индекс пуст — запусти `npm run index-fdc`',
        });
        continue;
      }
      if (candidates.length !== 3) {
        failures.push({
          message: `"${name}": вернулось ${candidates.length} кандидатов вместо 3`,
          remediation: 'В таблице fdc_foods недостаточно данных, либо фильтр ALLOWED_SOURCES отфильтровал слишком много',
        });
      }

      for (const c of candidates) {
        if (!(ALLOWED_SOURCES as readonly string[]).includes(c.source)) {
          failures.push({
            message: `"${name}": кандидат fdcId=${c.fdcId} имеет недопустимый source="${c.source}"`,
            remediation: 'MATCH-02 нарушен на уровне чтения — проверь ALLOWED_SOURCES фильтр в matchIngredient',
          });
        }
        if (!(c.similarity >= 0 && c.similarity <= 1)) {
          failures.push({
            message: `"${name}": кандидат fdcId=${c.fdcId} имеет similarity=${c.similarity} вне диапазона [0,1]`,
            remediation: 'Проверь формулу similarity = 1 - cosineDistance в fdc-repository.ts',
          });
        }
        if (BRAND_PROBE.test(c.description)) {
          failures.push({
            message: `"${name}": кандидат fdcId=${c.fdcId} "${c.description}" похож на брендовый продукт`,
            remediation: 'См. 01-RESEARCH.md Pattern 2 — проверь фильтр data_type в индексаторе',
          });
        }
      }
    }
  } finally {
    await closeDb();
  }

  if (!jsonMode) {
    for (const r of results) {
      printBlock(r);
    }
  }

  const ok = failures.length === 0;

  if (jsonMode) {
    console.log(JSON.stringify({ ok, results, failures }, null, 2));
  } else if (ok) {
    console.log('\nMATCHES OK');
  } else {
    console.log('\nПроверка не пройдена. Что делать:');
    failures.forEach((f, i) => console.log(`${i + 1}. ${f.message} — ${f.remediation}`));
  }

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
