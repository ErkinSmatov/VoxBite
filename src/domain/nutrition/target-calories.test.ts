import { describe, expect, it } from 'vitest';
import { calculateTargetCalories } from './target-calories.js';
import { CALORIE_FLOOR_FEMALE, CALORIE_FLOOR_MALE, MAX_RATE_KCAL_PER_DAY } from './constants.js';
import type { Goal, Sex } from './types.js';

const SEX_GOAL_COMBOS: Array<[Sex, Goal]> = [
  ['male', 'gain'],
  ['male', 'loss'],
  ['male', 'maintain'],
  ['female', 'gain'],
  ['female', 'loss'],
  ['female', 'maintain'],
];

describe('calculateTargetCalories', () => {
  it.each(SEX_GOAL_COMBOS)('%s / %s returns a finite integer targetKcal', (sex, goal) => {
    const result = calculateTargetCalories({ sex, tdee: 2500, goal });
    expect(Number.isFinite(result.targetKcal)).toBe(true);
    expect(Number.isInteger(result.targetKcal)).toBe(true);
  });

  it.each<[Sex]>([['male'], ['female']])('maintain: targetKcal === round(tdee), floorApplied false (%s)', (sex) => {
    const result = calculateTargetCalories({ sex, tdee: 2345.6, goal: 'maintain' });
    expect(result.targetKcal).toBe(Math.round(2345.6));
    expect(result.floorApplied).toBe(false);
  });

  it('loss at default rate: targetKcal = round(tdee - 257) when above sex floor', () => {
    const result = calculateTargetCalories({ sex: 'male', tdee: 2500, goal: 'loss' });
    expect(result.targetKcal).toBe(Math.round(2500 - MAX_RATE_KCAL_PER_DAY));
    expect(result.floorApplied).toBe(false);
  });

  it('gain at default rate: targetKcal = round(tdee + 257); floor never applies to gain', () => {
    const result = calculateTargetCalories({ sex: 'female', tdee: 1300, goal: 'gain' });
    expect(result.targetKcal).toBe(Math.round(1300 + MAX_RATE_KCAL_PER_DAY));
    expect(result.floorApplied).toBe(false);
  });

  it('floor collision, female: tdee 1300, loss -> targetKcal 1200, floorApplied true', () => {
    const result = calculateTargetCalories({ sex: 'female', tdee: 1300, goal: 'loss' });
    expect(result.targetKcal).toBe(CALORIE_FLOOR_FEMALE);
    expect(result.floorApplied).toBe(true);
  });

  it('floor collision, male: tdee 1600, loss -> targetKcal 1500, floorApplied true', () => {
    const result = calculateTargetCalories({ sex: 'male', tdee: 1600, goal: 'loss' });
    expect(result.targetKcal).toBe(CALORIE_FLOOR_MALE);
    expect(result.floorApplied).toBe(true);
  });

  it('desiredRateKgPerMonth: 2 is clamped to 1, deficit stays 257 (not 514)', () => {
    const result = calculateTargetCalories({ sex: 'male', tdee: 2500, goal: 'loss', desiredRateKgPerMonth: 2 });
    expect(result.rateKgPerMonth).toBe(1);
    expect(2500 - result.targetKcal).toBe(MAX_RATE_KCAL_PER_DAY);
  });

  it('desiredRateKgPerMonth: 0.5 produces a deficit of ~128 and rateKgPerMonth 0.5', () => {
    const result = calculateTargetCalories({ sex: 'male', tdee: 2500, goal: 'loss', desiredRateKgPerMonth: 0.5 });
    expect(result.rateKgPerMonth).toBe(0.5);
    expect(2500 - result.targetKcal).toBe(Math.round((7700 * 0.5) / 30));
  });

  it.each([[-1], [Number.NaN]])('desiredRateKgPerMonth: %d throws a descriptive error', (rate) => {
    expect(() =>
      calculateTargetCalories({ sex: 'male', tdee: 2500, goal: 'loss', desiredRateKgPerMonth: rate }),
    ).toThrow(/rate/i);
  });

  it('throws for non-finite or non-positive tdee', () => {
    expect(() => calculateTargetCalories({ sex: 'male', tdee: 0, goal: 'maintain' })).toThrow(/tdee/i);
    expect(() => calculateTargetCalories({ sex: 'male', tdee: Number.NaN, goal: 'maintain' })).toThrow(/tdee/i);
  });
});
