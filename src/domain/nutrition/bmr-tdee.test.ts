import { describe, expect, it } from 'vitest';
import { calculateBmr, calculateTdee } from './bmr-tdee.js';
import { ACTIVITY_MULTIPLIERS } from './constants.js';
import type { ActivityLevel, Sex } from './types.js';

describe('calculateBmr', () => {
  it.each([
    ['male' as Sex, 80, 180, 30, 1780],
    ['female' as Sex, 60, 165, 30, 1320.25],
  ])('%s / weight=%d height=%d age=%d -> bmr=%d', (sex, weightKg, heightCm, ageYears, expected) => {
    expect(calculateBmr(sex, weightKg, heightCm, ageYears)).toBeCloseTo(expected, 4);
  });

  it('male result is exactly 166 kcal higher than female for identical body inputs', () => {
    const male = calculateBmr('male', 70, 170, 25);
    const female = calculateBmr('female', 70, 170, 25);
    expect(male - female).toBeCloseTo(166, 4);
  });

  it.each([
    ['weight', 0, 180, 30],
    ['weight', -5, 180, 30],
    ['weight', Number.NaN, 180, 30],
    ['height', 80, 0, 30],
    ['height', 80, -1, 30],
    ['height', 80, Number.NaN, 30],
    ['age', 80, 180, 0],
    ['age', 80, 180, -1],
    ['age', 80, 180, Number.NaN],
  ])('throws a descriptive error when %s is invalid (%d, %d, %d)', (field, weightKg, heightCm, ageYears) => {
    expect(() => calculateBmr('male', weightKg, heightCm, ageYears)).toThrow(new RegExp(field, 'i'));
  });
});

describe('calculateTdee', () => {
  it.each([
    ['minimal' as ActivityLevel, 2400],
    ['low' as ActivityLevel, 2750],
    ['medium' as ActivityLevel, 3100],
    ['high' as ActivityLevel, 3450],
    ['very_high' as ActivityLevel, 3800],
  ])('bmr=2000, activity=%s -> tdee=%d', (activityLevel, expected) => {
    expect(calculateTdee(2000, activityLevel)).toBeCloseTo(expected, 4);
  });

  it('throws for an unknown activity level', () => {
    // @ts-expect-error deliberately passing an invalid value to test the guard
    expect(() => calculateTdee(2000, 'extreme')).toThrow(/activity/i);
  });
});

describe('ACTIVITY_MULTIPLIERS', () => {
  it('has exactly the five ActivityLevel keys and no others', () => {
    const keys = Object.keys(ACTIVITY_MULTIPLIERS).sort();
    expect(keys).toEqual(['high', 'low', 'medium', 'minimal', 'very_high']);
  });
});
