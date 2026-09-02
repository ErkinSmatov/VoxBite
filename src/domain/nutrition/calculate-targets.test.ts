import { describe, expect, it } from 'vitest';
import { calculateNutritionTargets } from './calculate-targets.js';
import type { Goal, NutritionProfile, Sex } from './types.js';

const MALE_BASE: Omit<NutritionProfile, 'goal'> = {
  sex: 'male',
  ageYears: 30,
  heightCm: 175,
  weightKg: 80,
  activityLevel: 'medium',
};

const FEMALE_BASE: Omit<NutritionProfile, 'goal'> = {
  sex: 'female',
  ageYears: 28,
  heightCm: 165,
  weightKg: 65,
  activityLevel: 'medium',
};

// Hand-computed end-to-end expectations (weight/height/age/activity=medium
// fixed above). Literal numbers, not recomputed formulas — see plan Task 3.
const CASES: Array<{
  sex: Sex;
  goal: Goal;
  expected: {
    bmr: number;
    tdee: number;
    targetKcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
    floorApplied: boolean;
    rateKgPerMonth: number;
  };
}> = [
  {
    sex: 'male',
    goal: 'gain',
    expected: {
      bmr: 1749,
      tdee: 2711,
      targetKcal: 2968,
      proteinG: 144,
      fatG: 72,
      carbsG: 436,
      floorApplied: false,
      rateKgPerMonth: 1,
    },
  },
  {
    sex: 'male',
    goal: 'loss',
    expected: {
      bmr: 1749,
      tdee: 2711,
      targetKcal: 2454,
      proteinG: 144,
      fatG: 72,
      carbsG: 308,
      floorApplied: false,
      rateKgPerMonth: 1,
    },
  },
  {
    sex: 'male',
    goal: 'maintain',
    expected: {
      bmr: 1749,
      tdee: 2711,
      targetKcal: 2711,
      proteinG: 144,
      fatG: 72,
      carbsG: 372,
      floorApplied: false,
      rateKgPerMonth: 0,
    },
  },
  {
    sex: 'female',
    goal: 'gain',
    expected: {
      bmr: 1380,
      tdee: 2139,
      targetKcal: 2396,
      proteinG: 117,
      fatG: 59,
      carbsG: 350,
      floorApplied: false,
      rateKgPerMonth: 1,
    },
  },
  {
    sex: 'female',
    goal: 'loss',
    expected: {
      bmr: 1380,
      tdee: 2139,
      targetKcal: 1882,
      proteinG: 117,
      fatG: 59,
      carbsG: 222,
      floorApplied: false,
      rateKgPerMonth: 1,
    },
  },
  {
    sex: 'female',
    goal: 'maintain',
    expected: {
      bmr: 1380,
      tdee: 2139,
      targetKcal: 2139,
      proteinG: 117,
      fatG: 59,
      carbsG: 286,
      floorApplied: false,
      rateKgPerMonth: 0,
    },
  },
];

describe('calculateNutritionTargets', () => {
  it.each(CASES)('$sex / $goal matches hand-computed targets', ({ sex, goal, expected }) => {
    const profile: NutritionProfile = { ...(sex === 'male' ? MALE_BASE : FEMALE_BASE), sex, goal };
    const result = calculateNutritionTargets(profile);
    expect(result).toEqual(expected);
  });

  it("maintain case has targetKcal === Math.round(tdee)", () => {
    const profile: NutritionProfile = { ...MALE_BASE, sex: 'male', goal: 'maintain' };
    const result = calculateNutritionTargets(profile);
    expect(result.targetKcal).toBe(Math.round(result.tdee));
  });
});
