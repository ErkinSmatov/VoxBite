import { describe, expect, it } from 'vitest';
import { calculateTargetMacros } from './target-macros';

describe('calculateTargetMacros', () => {
  it('80kg, 2500 kcal: protein 144, fat 72 (g/kg rule binds), carbs 319', () => {
    const result = calculateTargetMacros(80, 2500);
    expect(result).toEqual({ proteinG: 144, fatG: 72, carbsG: 319 });
  });

  it('50kg, 2600 kcal: fat-share floor engages (20% rule binds over g/kg)', () => {
    const result = calculateTargetMacros(50, 2600);
    expect(result.fatG).toBe(58);
  });

  it('120kg, 1500 kcal: protein+fat already exceed target, carbs clamp to 0', () => {
    const result = calculateTargetMacros(120, 1500);
    expect(result.carbsG).toBe(0);
  });

  it.each([
    [80, 2500],
    [50, 2600],
    [120, 1500],
    [60, 1800],
    [90, 3200],
  ])('weight=%d kcal=%d returns non-negative integer grams', (weightKg, targetKcal) => {
    const result = calculateTargetMacros(weightKg, targetKcal);
    for (const value of Object.values(result)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it.each([
    [0, 2000],
    [-5, 2000],
    [Number.NaN, 2000],
    [70, 0],
    [70, -100],
    [70, Number.NaN],
  ])('throws for invalid input weight=%d kcal=%d', (weightKg, targetKcal) => {
    expect(() => calculateTargetMacros(weightKg, targetKcal)).toThrow();
  });
});
