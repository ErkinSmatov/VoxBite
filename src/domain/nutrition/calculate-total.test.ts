import { describe, expect, it } from 'vitest';
import { calculateTotal } from './calculate-total.js';
import type { TotalInputItem } from './calculate-total.js';

describe('calculateTotal', () => {
  it('full data: two components sum kcal, missingCount is 0', () => {
    const items: TotalInputItem[] = [
      { grams: 100, kcal: 200, proteinG: 20, fatG: 10, carbsG: 5, sugarG: 2 },
      { grams: 50, kcal: 100, proteinG: 8, fatG: 4, carbsG: 2, sugarG: 1 },
    ];
    const result = calculateTotal(items);
    expect(result.kcal).toBe(250);
    expect(result.missingCount.kcal).toBe(0);
    expect(result.proteinG).toBe(24);
    expect(result.fatG).toBe(12);
    expect(result.carbsG).toBe(6);
    expect(result.sugarG).toBe(2.5);
    expect(result.missingCount).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, sugarG: 0 });
  });

  it('partial data: one of three components has sugarG null -> sums other two, missingCount.sugarG is 1', () => {
    const items: TotalInputItem[] = [
      { grams: 100, kcal: 100, proteinG: 10, fatG: 5, carbsG: 5, sugarG: 3 },
      { grams: 100, kcal: 100, proteinG: 10, fatG: 5, carbsG: 5, sugarG: null },
      { grams: 100, kcal: 100, proteinG: 10, fatG: 5, carbsG: 5, sugarG: 2 },
    ];
    const result = calculateTotal(items);
    expect(result.sugarG).toBe(5);
    expect(result.missingCount.sugarG).toBe(1);
  });

  it('all-null: every component has sugarG null -> total is null and missingCount equals component count', () => {
    const items: TotalInputItem[] = [
      { grams: 100, kcal: 100, proteinG: 10, fatG: 5, carbsG: 5, sugarG: null },
      { grams: 100, kcal: 100, proteinG: 10, fatG: 5, carbsG: 5, sugarG: null },
    ];
    const result = calculateTotal(items);
    expect(result.sugarG).toBeNull();
    expect(result.missingCount.sugarG).toBe(2);
  });

  it('zero components: every total is null, every missingCount is 0', () => {
    const result = calculateTotal([]);
    expect(result).toEqual({
      kcal: null,
      proteinG: null,
      fatG: null,
      carbsG: null,
      sugarG: null,
      missingCount: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, sugarG: 0 },
    });
  });

  it('recompute invariance: +10/-10/+10 grams, recomputed from scratch at each step, equals one direct computation at the final grams', () => {
    const base: TotalInputItem = { grams: 100, kcal: 200, proteinG: 20, fatG: 10, carbsG: 5, sugarG: 2 };

    let grams = base.grams;
    grams += 10; // step 1: +10
    calculateTotal([{ ...base, grams }]);
    grams -= 10; // step 2: -10
    calculateTotal([{ ...base, grams }]);
    grams += 10; // step 3: +10
    const recomputed = calculateTotal([{ ...base, grams }]);

    const direct = calculateTotal([{ ...base, grams: 110 }]);

    expect(recomputed).toEqual(direct);
  });

  it.each([
    [{ grams: -1, kcal: 100, proteinG: null, fatG: null, carbsG: null, sugarG: null }],
    [{ grams: Number.NaN, kcal: 100, proteinG: null, fatG: null, carbsG: null, sugarG: null }],
    [{ grams: Number.POSITIVE_INFINITY, kcal: 100, proteinG: null, fatG: null, carbsG: null, sugarG: null }],
    [{ grams: 100, kcal: Number.NaN, proteinG: null, fatG: null, carbsG: null, sugarG: null }],
    [{ grams: 100, kcal: Number.POSITIVE_INFINITY, proteinG: null, fatG: null, carbsG: null, sugarG: null }],
  ])('throws for invalid input %j', (item) => {
    expect(() => calculateTotal([item as TotalInputItem])).toThrow();
  });
});
