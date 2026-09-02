// Goal-adjusted target calories with the 1 kg/month rate cap and the
// sex-specific safety floor (TECH_SPEC.md §6.3).

import {
  CALORIE_FLOOR_FEMALE,
  CALORIE_FLOOR_MALE,
  DAYS_PER_MONTH,
  KCAL_PER_KG_BODY_MASS,
  MAX_RATE_KG_PER_MONTH,
} from './constants.js';
import type { Goal, Sex } from './types.js';

export interface TargetCaloriesInput {
  sex: Sex;
  tdee: number;
  goal: Goal;
  /** Optional; clamped to [0, MAX_RATE_KG_PER_MONTH]. Defaults to MAX_RATE_KG_PER_MONTH. */
  desiredRateKgPerMonth?: number;
}

export interface TargetCaloriesResult {
  targetKcal: number;
  /** True when the safety floor overrode the calculated deficit. */
  floorApplied: boolean;
  /** The rate actually used, after clamping to MAX_RATE_KG_PER_MONTH. */
  rateKgPerMonth: number;
}

export function calculateTargetCalories({
  sex,
  tdee,
  goal,
  desiredRateKgPerMonth,
}: TargetCaloriesInput): TargetCaloriesResult {
  if (!Number.isFinite(tdee) || tdee <= 0) {
    throw new Error(`Invalid nutrition profile input: tdee must be a finite number greater than 0 (got ${tdee}).`);
  }

  if (goal === 'maintain') {
    return { targetKcal: Math.round(tdee), floorApplied: false, rateKgPerMonth: 0 };
  }

  // Resolve the requested rate, defaulting to the maximum allowed rate.
  const requestedRate = desiredRateKgPerMonth ?? MAX_RATE_KG_PER_MONTH;
  if (!Number.isFinite(requestedRate) || requestedRate < 0) {
    throw new Error(
      `Invalid nutrition profile input: desiredRateKgPerMonth must be a finite number >= 0 (got ${requestedRate}).`,
    );
  }

  // Hard product constraint (PROJECT.md/CLAUDE.md): never target weight
  // change faster than MAX_RATE_KG_PER_MONTH, no matter what was requested.
  const rateKgPerMonth = Math.min(requestedRate, MAX_RATE_KG_PER_MONTH);

  const dailyDelta = Math.round((rateKgPerMonth * KCAL_PER_KG_BODY_MASS) / DAYS_PER_MONTH);
  const raw = goal === 'gain' ? tdee + dailyDelta : tdee - dailyDelta;

  if (goal === 'loss') {
    // Safety floor: never let a calculated deficit push the target below the
    // sex-specific minimum. Hard-coded and not user-adjustable — dropping
    // below ~1200/1500 kcal without medical supervision is unsafe, and this
    // bot is explicitly not a medical device (TECH_SPEC §6.3, §6.5). Applied
    // AFTER the rate-cap adjustment, per 01-RESEARCH.md.
    const floor = sex === 'male' ? CALORIE_FLOOR_MALE : CALORIE_FLOOR_FEMALE;
    const targetKcal = Math.round(Math.max(raw, floor));
    return { targetKcal, floorApplied: raw < floor, rateKgPerMonth };
  }

  // gain: no floor concern.
  return { targetKcal: Math.round(raw), floorApplied: false, rateKgPerMonth };
}
