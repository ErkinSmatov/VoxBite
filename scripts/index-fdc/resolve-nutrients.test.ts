import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NUTRIENT_ID_PRIORITY,
  buildNutrientIndex,
  resolveNutrient,
  resolveFoodNutrients,
} from './resolve-nutrients.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(dirname, '__fixtures__/food-nutrient-sample.csv');

describe('NUTRIENT_ID_PRIORITY', () => {
  it('matches the verified USDA nutrient IDs', () => {
    expect(NUTRIENT_ID_PRIORITY.kcal).toEqual([1008, 2047, 2048]);
    expect(NUTRIENT_ID_PRIORITY.proteinG).toEqual([1003]);
    expect(NUTRIENT_ID_PRIORITY.fatG).toEqual([1004]);
    expect(NUTRIENT_ID_PRIORITY.carbsG).toEqual([1005]);
    expect(NUTRIENT_ID_PRIORITY.sugarG).toEqual([2000, 1063]);
  });
});

describe('resolveNutrient', () => {
  it('returns the 1008 value when present', () => {
    const map = new Map([[1008, 165], [2047, 110], [2048, 95]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.kcal)).toBe(165);
  });

  it('falls back to 2047 when 1008 is absent', () => {
    const map = new Map([[2047, 110], [2048, 95]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.kcal)).toBe(110);
  });

  it('falls back to 2048 when both 1008 and 2047 are absent', () => {
    const map = new Map([[2048, 95]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.kcal)).toBe(95);
  });

  it('returns null, not 0, when none of the priority IDs are present', () => {
    const map = new Map([[1051, 100]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.kcal)).toBeNull();
  });

  it('resolves sugar 2000 before 1063', () => {
    const map = new Map([[2000, 0.5], [1063, 2.1]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.sugarG)).toBe(0.5);
  });

  it('falls back to 1063 when 2000 is absent', () => {
    const map = new Map([[1063, 2.1]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.sugarG)).toBe(2.1);
  });

  it('treats a measured amount of 0 as a real value, not null', () => {
    const map = new Map([[1005, 0]]);
    expect(resolveNutrient(map, NUTRIENT_ID_PRIORITY.carbsG)).toBe(0);
  });
});

describe('resolveFoodNutrients', () => {
  it('returns all-null for undefined (a food with no nutrient rows)', () => {
    const result = resolveFoodNutrients(undefined);
    expect(result).toEqual({ kcal: null, proteinG: null, fatG: null, carbsG: null, sugarG: null });
  });

  it('does not compute the Atwater fallback if any macro is null', () => {
    const map = new Map([[1004, 10], [1005, 5]]); // protein missing
    const result = resolveFoodNutrients(map);
    expect(result.proteinG).toBeNull();
    expect(result.kcal).toBeNull();
  });

  it('computes the Atwater sum only when kcal is absent and all three macros are present', () => {
    const map = new Map([[1003, 2], [1004, 1], [1005, 4]]);
    const result = resolveFoodNutrients(map);
    expect(result.kcal).toBe(2 * 4 + 1 * 9 + 4 * 4);
    expect(result.kcalDerived).toBe(true);
  });

  it('does not mark kcalDerived when a direct kcal ID is present', () => {
    const map = new Map([[1008, 165], [1003, 31], [1004, 3.6], [1005, 0], [2000, 0.5]]);
    const result = resolveFoodNutrients(map);
    expect(result.kcal).toBe(165);
    expect(result.kcalDerived).toBeFalsy();
  });
});

describe('buildNutrientIndex', () => {
  it('keeps only fdc_ids in wantedFdcIds', async () => {
    const wanted = new Set([3000001]);
    const { index } = await buildNutrientIndex(fixture, wanted);
    expect(index.has(3000001)).toBe(true);
    expect(index.has(3000099)).toBe(false);
  });

  it('resolves kcal fallback chain across real fixture rows: 1008, then 2047, then 2048', async () => {
    const wanted = new Set([3000001, 3000002, 3000003]);
    const { index } = await buildNutrientIndex(fixture, wanted);
    expect(resolveFoodNutrients(index.get(3000001)).kcal).toBe(165);
    expect(resolveFoodNutrients(index.get(3000002)).kcal).toBe(110);
    expect(resolveFoodNutrients(index.get(3000003)).kcal).toBe(95);
  });

  it('resolves sugar fallback: a record with only 1063 still gets a sugar value', async () => {
    const wanted = new Set([3000004]);
    const { index } = await buildNutrientIndex(fixture, wanted);
    const nutrients = resolveFoodNutrients(index.get(3000004));
    expect(nutrients.sugarG).toBe(2.1);
  });

  it('treats an empty amount as absent (null), never 0 or NaN', async () => {
    const wanted = new Set([3000005]);
    const { index, unparsableAmountCount } = await buildNutrientIndex(fixture, wanted);
    const nutrients = resolveFoodNutrients(index.get(3000005));
    expect(nutrients.proteinG).toBeNull();
    expect(unparsableAmountCount).toBeGreaterThanOrEqual(1);
  });

  it('treats a measured amount of 0 as a real value', async () => {
    const wanted = new Set([3000006]);
    const { index } = await buildNutrientIndex(fixture, wanted);
    const nutrients = resolveFoodNutrients(index.get(3000006));
    expect(nutrients.carbsG).toBe(0);
  });

  it('resolves duplicate (fdc_id, nutrient_id) pairs first-seen-wins and counts them', async () => {
    const wanted = new Set([3000007]);
    const { index, duplicateCount } = await buildNutrientIndex(fixture, wanted);
    const nutrients = resolveFoodNutrients(index.get(3000007));
    expect(nutrients.proteinG).toBe(10); // first-seen value, not 99
    expect(duplicateCount).toBeGreaterThanOrEqual(1);
  });

  it('returns all-null for a food whose only nutrient is unrelated to any macro', async () => {
    const wanted = new Set([3000008]);
    const { index } = await buildNutrientIndex(fixture, wanted);
    const nutrients = resolveFoodNutrients(index.get(3000008));
    expect(nutrients).toEqual({ kcal: null, proteinG: null, fatG: null, carbsG: null, sugarG: null });
  });
});
