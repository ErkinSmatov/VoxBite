// Единственное место, где меняются нутрициологические константы.
// Менять здесь, не в формулах.
//
// This is the ONLY file where nutrition tuning numbers should live. Every
// formula file (bmr-tdee.ts, target-calories.ts, target-macros.ts) imports
// from here rather than hard-coding a number, so a nutritionist (not a
// programmer) can change a value in this file without touching any math.

import type { ActivityLevel } from './types.js';

/**
 * Activity multipliers applied to BMR to get TDEE (TECH_SPEC.md §6.2).
 * Source: standard Harris-Benedict/Mifflin-St Jeor activity-factor table.
 */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  minimal: 1.2,
  low: 1.375,
  medium: 1.55,
  high: 1.725,
  very_high: 1.9,
};

/**
 * Grams of protein per kg of body weight (D-04 default; TECH_SPEC §6.4
 * documents an acceptable range of 1.6-2.0 g/kg). This is an adjustable
 * default Claude chose during planning, not a medical recommendation.
 */
export const PROTEIN_G_PER_KG = 1.8;

/**
 * Grams of fat per kg of body weight (D-04 default; TECH_SPEC §6.4
 * documents an acceptable range of 0.8-1.0 g/kg). This is an adjustable
 * default Claude chose during planning, not a medical recommendation.
 */
export const FAT_G_PER_KG = 0.9;

/**
 * Minimum share of daily calories that must come from fat, regardless of
 * the g/kg rule above (TECH_SPEC §6.4: fat must be at least 20% of daily
 * calories — a second, independent lower bound on fat).
 */
export const MIN_FAT_KCAL_SHARE = 0.2;

/**
 * Hard-coded minimum daily calorie target for women on a weight-loss goal
 * (TECH_SPEC §6.3: "должно быть жёстко закодировано как нижняя граница").
 * Dropping below this without medical supervision is unsafe, and this bot
 * is explicitly not a medical device (TECH_SPEC §6.5).
 */
export const CALORIE_FLOOR_FEMALE = 1200;

/**
 * Hard-coded minimum daily calorie target for men on a weight-loss goal
 * (TECH_SPEC §6.3). Same safety rationale as CALORIE_FLOOR_FEMALE.
 */
export const CALORIE_FLOOR_MALE = 1500;

/**
 * Approximate kilocalories stored per kilogram of body mass, used to convert
 * a desired rate of weight change (kg/month) into a daily calorie
 * surplus/deficit. Standard nutrition-science approximation.
 */
export const KCAL_PER_KG_BODY_MASS = 7700;

/** Days per month used for the rate-of-change to daily-delta conversion. */
export const DAYS_PER_MONTH = 30;

/**
 * Hard product constraint (PROJECT.md / CLAUDE.md): weight change must
 * never be targeted faster than 1 kg per month, no matter what the user
 * requests. This is enforced in code (target-calories.ts), not just UI copy.
 */
export const MAX_RATE_KG_PER_MONTH = 1;

/**
 * The daily calorie surplus/deficit that corresponds to the maximum
 * allowed rate of change (≈257 kcal/day for 1 kg/month).
 */
export const MAX_RATE_KCAL_PER_DAY = Math.round(
  (KCAL_PER_KG_BODY_MASS * MAX_RATE_KG_PER_MONTH) / DAYS_PER_MONTH,
);

/** Kilocalories per gram of protein (standard Atwater factor). */
export const KCAL_PER_G_PROTEIN = 4;

/** Kilocalories per gram of fat (standard Atwater factor). */
export const KCAL_PER_G_FAT = 9;

/** Kilocalories per gram of carbohydrate (standard Atwater factor). */
export const KCAL_PER_G_CARB = 4;
