/**
 * Priority-ordered nutrient-ID resolution for USDA FDC `food_nutrient.csv`
 * rows.
 *
 * Ноль и «нет данных» — разные вещи. `0` означает, что USDA измерил ноль;
 * `null` означает, что данных нет. Никогда не заменяй null на 0 — см.
 * TECH_SPEC §5.8.
 *
 * 01-RESEARCH.md's second most important finding for this plan: a single
 * hardcoded nutrient ID per macro (e.g. always reading calories from ID
 * 1008 "Energy") yields null calories for 71% of Foundation Foods records,
 * because many records only carry the derived-energy IDs 2047
 * ("Energy (Atwater General Factors)") or 2048 ("Energy (Atwater Specific
 * Factors)") instead of 1008. Verified coverage (Foundation Foods):
 *   - kcal:    1008 ~29%, 2047/2048 cover most of the remaining 71%
 *   - sugar:   2000 ("Sugars, total") is sparse; 1063
 *              ("Sugars, Total NLEA") covers the majority of records
 * A single hardcoded ID per macro is therefore a data-mapping bug, not a
 * simplification — this file's whole job is to never regress to that.
 */
import * as fs from 'node:fs';
import { parse } from 'csv-parse';

export const NUTRIENT_ID_PRIORITY = {
  kcal: [1008, 2047, 2048],
  proteinG: [1003],
  fatG: [1004],
  carbsG: [1005],
  sugarG: [2000, 1063],
} as const;

export interface FoodNutrients {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  /** True when kcal was computed via the Atwater macro-sum fallback rather
   * than read directly from a kcal nutrient ID. Lets the loader (Plan 06)
   * log how many rows needed the fallback. */
  kcalDerived?: boolean;
}

/** fdcId -> nutrientId -> amount. */
export type NutrientIndex = Map<number, Map<number, number>>;

interface FoodNutrientCsvRow {
  id: string;
  fdc_id: string;
  nutrient_id: string;
  amount: string;
}

/**
 * Iterates `priority` in order and returns the first finite value found in
 * `byNutrientId`. Missing/empty/NaN entries are skipped. Returns `null` —
 * never `0`, never `?? 0` — when none of the priority IDs are present.
 */
export function resolveNutrient(
  byNutrientId: Map<number, number>,
  priority: readonly number[],
): number | null {
  for (const nutrientId of priority) {
    const value = byNutrientId.get(nutrientId);
    if (value !== undefined && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Resolves all five per-100g fields for one food from its nutrient-ID map.
 * `undefined` (a food with no nutrient rows at all) resolves to all-null
 * without throwing.
 *
 * kcal falls back to the Atwater sum (protein*4 + fat*9 + carbs*4) ONLY
 * when none of 1008/2047/2048 are present AND all three macros are
 * non-null — a partial macro set must never produce a fabricated kcal
 * value.
 */
export function resolveFoodNutrients(byNutrientId: Map<number, number> | undefined): FoodNutrients {
  if (!byNutrientId) {
    return { kcal: null, proteinG: null, fatG: null, carbsG: null, sugarG: null };
  }

  const proteinG = resolveNutrient(byNutrientId, NUTRIENT_ID_PRIORITY.proteinG);
  const fatG = resolveNutrient(byNutrientId, NUTRIENT_ID_PRIORITY.fatG);
  const carbsG = resolveNutrient(byNutrientId, NUTRIENT_ID_PRIORITY.carbsG);
  const sugarG = resolveNutrient(byNutrientId, NUTRIENT_ID_PRIORITY.sugarG);

  let kcal = resolveNutrient(byNutrientId, NUTRIENT_ID_PRIORITY.kcal);
  let kcalDerived: boolean | undefined;
  if (kcal === null && proteinG !== null && fatG !== null && carbsG !== null) {
    kcal = proteinG * 4 + fatG * 9 + carbsG * 4;
    kcalDerived = true;
  }

  return { kcal, proteinG, fatG, carbsG, sugarG, kcalDerived };
}

/**
 * Streams `food_nutrient.csv` (~10 MB for Foundation, ~36 MB for SR
 * Legacy — streaming, not optional) via `createReadStream` + `csv-parse`,
 * keeping only rows whose `fdc_id` is in `wantedFdcIds` (checked before any
 * number parsing — this is the hot path over 200k+ rows).
 *
 * `amount` is parsed with `Number()` guarded by `Number.isFinite`; an
 * empty/unparsable amount is counted in `unparsableAmountCount` and the
 * row is dropped rather than stored as 0 or NaN. A repeated
 * `(fdcId, nutrientId)` pair keeps the first value seen and increments
 * `duplicateCount` instead of throwing or summing — 01-RESEARCH.md
 * verified both anomalies exist in the real Foundation bundle (duplicates
 * and empty amounts), so seeing 0 of either on a real run is itself a
 * signal something is wrong.
 */
export async function buildNutrientIndex(
  foodNutrientCsvPath: string,
  wantedFdcIds: Set<number>,
): Promise<{ index: NutrientIndex; duplicateCount: number; unparsableAmountCount: number }> {
  const index: NutrientIndex = new Map();
  let duplicateCount = 0;
  let unparsableAmountCount = 0;

  const parser = fs.createReadStream(foodNutrientCsvPath).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true }),
  );

  for await (const record of parser as AsyncIterable<FoodNutrientCsvRow>) {
    const fdcId = Number(record.fdc_id);
    if (!wantedFdcIds.has(fdcId)) {
      continue;
    }

    const nutrientId = Number(record.nutrient_id);
    // Number('') === 0 and Number('  ') === 0 in JS — an empty/whitespace
    // amount must resolve as "no data", never as a measured 0, so check for
    // blank input explicitly before the numeric conversion.
    const trimmedAmount = record.amount?.trim() ?? '';
    const amount = trimmedAmount.length > 0 ? Number(trimmedAmount) : NaN;
    if (!Number.isFinite(amount)) {
      unparsableAmountCount += 1;
      continue;
    }

    let byNutrientId = index.get(fdcId);
    if (!byNutrientId) {
      byNutrientId = new Map();
      index.set(fdcId, byNutrientId);
    }

    if (byNutrientId.has(nutrientId)) {
      duplicateCount += 1;
      continue; // first-seen-wins
    }

    byNutrientId.set(nutrientId, amount);
  }

  return { index, duplicateCount, unparsableAmountCount };
}
