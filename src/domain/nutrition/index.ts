// Public barrel for the nutrition domain module. Phase 2 onboarding imports
// from 'src/domain/nutrition', never from the individual files.

export { calculateBmr, calculateTdee } from './bmr-tdee.js';
export { calculateTargetCalories } from './target-calories.js';
export type { TargetCaloriesInput, TargetCaloriesResult } from './target-calories.js';
export { calculateTargetMacros } from './target-macros.js';
export type { TargetMacrosResult } from './target-macros.js';
export { calculateNutritionTargets } from './calculate-targets.js';
export type { ActivityLevel, Goal, NutritionProfile, NutritionTargets, Sex } from './types.js';
export { calculateTotal } from './calculate-total.js';
export type { NutrientTotal, TotalInputItem } from './calculate-total.js';
