/**
 * assemble-profile — turns the onboarding conversation's collected answers
 * into the NutritionProfile the Phase 1 domain math accepts (ONBOARD-01).
 *
 * Composition only, no math of its own — everything is delegated to
 * calculateNutritionTargets via the domain barrel (never the individual
 * files, per src/domain/nutrition/index.ts's own barrel comment).
 */

import type { ActivityLevel, Goal, NutritionProfile, Sex } from '../../domain/nutrition/index.js';

export interface OnboardingAnswers {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  desiredRateKgPerMonth?: number;
  /** Persisted by the bot onto the users row, but NOT part of NutritionProfile. */
  timezone: string;
}

export function assembleProfile(answers: OnboardingAnswers): NutritionProfile {
  // Explicit destructure, never a full-object spread of the answers: the
  // NutritionProfile type has no timezone field, and spreading the whole
  // OnboardingAnswers object would leak timezone onto the profile passed
  // into the domain math.
  const { sex, ageYears, heightCm, weightKg, activityLevel, goal, desiredRateKgPerMonth } = answers;

  if (goal === 'maintain') {
    return { sex, ageYears, heightCm, weightKg, activityLevel, goal };
  }

  return { sex, ageYears, heightCm, weightKg, activityLevel, goal, desiredRateKgPerMonth };
}
