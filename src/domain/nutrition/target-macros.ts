// Target protein/fat/carb grams from the D-04 presets (TECH_SPEC.md §6.4).

import {
  FAT_G_PER_KG,
  KCAL_PER_G_CARB,
  KCAL_PER_G_FAT,
  KCAL_PER_G_PROTEIN,
  MIN_FAT_KCAL_SHARE,
  PROTEIN_G_PER_KG,
} from './constants';

export interface TargetMacrosResult {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export function calculateTargetMacros(weightKg: number, targetKcal: number): TargetMacrosResult {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error(`Invalid nutrition profile input: weightKg must be a finite number greater than 0 (got ${weightKg}).`);
  }
  if (!Number.isFinite(targetKcal) || targetKcal <= 0) {
    throw new Error(`Invalid nutrition profile input: targetKcal must be a finite number greater than 0 (got ${targetKcal}).`);
  }

  const proteinG = weightKg * PROTEIN_G_PER_KG;

  // TECH_SPEC §6.4 imposes both a per-kg rule and a minimum share of daily
  // calories for fat; the binding constraint is whichever is larger.
  const fatG = Math.max(weightKg * FAT_G_PER_KG, (targetKcal * MIN_FAT_KCAL_SHARE) / KCAL_PER_G_FAT);

  const remainingKcal = targetKcal - (proteinG * KCAL_PER_G_PROTEIN + fatG * KCAL_PER_G_FAT);
  // Defensive clamp: a negative remainder means the protein/fat presets
  // already exceed the calorie target for this body weight (e.g. a heavy
  // person sitting at the safety floor). A later phase should surface a
  // warning to the user rather than silently showing 0 g carbs — that
  // warning is not built here (see SUMMARY known limitation).
  const carbsG = Math.max(0, remainingKcal / KCAL_PER_G_CARB);

  return {
    proteinG: Math.round(proteinG),
    fatG: Math.round(fatG),
    carbsG: Math.round(carbsG),
  };
}
