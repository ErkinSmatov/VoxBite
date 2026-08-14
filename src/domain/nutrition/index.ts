// Public barrel for the nutrition domain module. Phase 2 onboarding imports
// from 'src/domain/nutrition', never from the individual files.

export { calculateBmr, calculateTdee } from './bmr-tdee';
export { calculateTargetCalories } from './target-calories';
export type { TargetCaloriesInput, TargetCaloriesResult } from './target-calories';
export { calculateTargetMacros } from './target-macros';
export type { TargetMacrosResult } from './target-macros';
export { calculateNutritionTargets } from './calculate-targets';
export type { ActivityLevel, Goal, NutritionProfile, NutritionTargets, Sex } from './types';
export { calculateTotal } from './calculate-total';
export type { NutrientTotal, TotalInputItem } from './calculate-total';
