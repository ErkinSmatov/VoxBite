// Mifflin-St Jeor BMR and activity-multiplied TDEE (TECH_SPEC.md §6.1-6.2).

import { ACTIVITY_MULTIPLIERS } from './constants.js';
import type { ActivityLevel, Sex } from './types.js';

function assertPositiveFinite(field: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid nutrition profile input: ${field} must be a finite number greater than 0 (got ${value}).`);
  }
}

/**
 * Basal Metabolic Rate via the Mifflin-St Jeor equation (TECH_SPEC §6.1).
 * Not rounded here — rounding happens once, at the end of the calculation
 * pipeline, so intermediate error does not accumulate.
 */
export function calculateBmr(sex: Sex, weightKg: number, heightCm: number, ageYears: number): number {
  assertPositiveFinite('weight', weightKg);
  assertPositiveFinite('height', heightCm);
  assertPositiveFinite('age', ageYears);

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === 'male' ? base + 5 : base - 161;
}

/**
 * Total Daily Energy Expenditure: BMR scaled by the activity-level
 * multiplier (TECH_SPEC §6.2).
 */
export function calculateTdee(bmr: number, activityLevel: ActivityLevel): number {
  assertPositiveFinite('bmr', bmr);

  const multiplier = ACTIVITY_MULTIPLIERS[activityLevel];
  if (multiplier === undefined) {
    throw new Error(`Invalid activity level: "${activityLevel}" is not a known ActivityLevel.`);
  }

  return bmr * multiplier;
}
