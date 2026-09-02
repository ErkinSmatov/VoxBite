// Single composed entry point Phase 2's onboarding conversation calls.

import { calculateBmr, calculateTdee } from './bmr-tdee.js';
import { calculateTargetCalories } from './target-calories.js';
import { calculateTargetMacros } from './target-macros.js';
import type { NutritionProfile, NutritionTargets } from './types.js';

export function calculateNutritionTargets(profile: NutritionProfile): NutritionTargets {
  const { sex, ageYears, heightCm, weightKg, activityLevel, goal, desiredRateKgPerMonth } = profile;

  const bmr = calculateBmr(sex, weightKg, heightCm, ageYears);
  const tdee = calculateTdee(bmr, activityLevel);
  const { targetKcal, floorApplied, rateKgPerMonth } = calculateTargetCalories({
    sex,
    tdee,
    goal,
    desiredRateKgPerMonth,
  });
  const { proteinG, fatG, carbsG } = calculateTargetMacros(weightKg, targetKcal);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    targetKcal,
    proteinG,
    fatG,
    carbsG,
    floorApplied,
    rateKgPerMonth,
  };
}
