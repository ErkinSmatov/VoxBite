// The single CALC-01 arithmetic: total kcal/protein/fat/carbs/sugar for a
// confirmed set of dish components, with D-09's partial-total accounting.
//
// D-03 requires the "≈" preview shown during correction and the number
// written into `diary` to come from this SAME function — never a second,
// approximate summation. Callers always pass the full current component
// array and get a total computed from scratch (see recompute-invariance
// test in calculate-total.test.ts / 04-RESEARCH.md Pitfall 5); this
// function never accepts or returns a running/incremental total.
//
// Rounding decision (04-RESEARCH.md Open Question 2): this function returns
// raw, unrounded floats. Rounding happens at render time only (formatting
// for the correction card / diary display), so Phase 5's weekly sums do not
// compound rounding error. Do not round inside this function.

const NUTRIENT_KEYS = ['kcal', 'proteinG', 'fatG', 'carbsG', 'sugarG'] as const;
type NutrientKey = (typeof NUTRIENT_KEYS)[number];

/**
 * One component's per-100g nutrient values plus its confirmed grams.
 * Field names intentionally mirror `FdcCandidate`
 * (src/domain/fdc-matching/types.ts) so callers can spread a candidate in
 * without a rename layer.
 */
export interface TotalInputItem {
  grams: number;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
}

export interface NutrientTotal {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  /** Count of items whose value for that nutrient key was null (never treated as 0). */
  missingCount: Record<NutrientKey, number>;
}

function validateItem(item: TotalInputItem): void {
  if (!Number.isFinite(item.grams) || item.grams < 0) {
    throw new Error(`Invalid nutrient total input: grams must be a finite number >= 0 (got ${item.grams}).`);
  }
  for (const key of NUTRIENT_KEYS) {
    const value = item[key];
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`Invalid nutrient total input: ${key} must be finite or null (got ${value}).`);
    }
  }
}

export function calculateTotal(items: TotalInputItem[]): NutrientTotal {
  for (const item of items) {
    validateItem(item);
  }

  const sums: Record<NutrientKey, number> = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, sugarG: 0 };
  const presentCount: Record<NutrientKey, number> = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, sugarG: 0 };
  const missingCount: Record<NutrientKey, number> = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, sugarG: 0 };

  for (const item of items) {
    for (const key of NUTRIENT_KEYS) {
      const perHundred = item[key];
      if (perHundred === null) {
        missingCount[key] += 1;
        continue;
      }
      sums[key] += (item.grams / 100) * perHundred;
      presentCount[key] += 1;
    }
  }

  const result = {} as NutrientTotal;
  for (const key of NUTRIENT_KEYS) {
    result[key] = presentCount[key] > 0 ? sums[key] : null;
  }
  result.missingCount = missingCount;

  return result;
}
