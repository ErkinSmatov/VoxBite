// Public barrel for the fdc-matching domain module. Phase 3 (component
// matching) and Phase 4 (candidate picker) import from
// 'src/domain/fdc-matching', never from the individual files.

export { matchIngredient } from './match-ingredient.js';
export type { MatchIngredientArgs } from './match-ingredient.js';
export { ALLOWED_SOURCES, CANDIDATE_COUNT } from './types.js';
export type { FdcCandidate, FdcRepository } from './types.js';
