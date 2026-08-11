// Domain types for the nutrition math module. No runtime code here.

export type Sex = 'male' | 'female';

export type Goal = 'gain' | 'loss' | 'maintain';

export type ActivityLevel = 'minimal' | 'low' | 'medium' | 'high' | 'very_high';

export interface NutritionProfile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  /** Optional; clamped to [0, MAX_RATE_KG_PER_MONTH]. */
  desiredRateKgPerMonth?: number;
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  targetKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** True when the safety floor overrode the requested deficit. */
  floorApplied: boolean;
  /** The rate actually used after clamping to MAX_RATE_KG_PER_MONTH. */
  rateKgPerMonth: number;
}
