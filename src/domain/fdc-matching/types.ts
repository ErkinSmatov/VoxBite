/**
 * Hexagonal port for FDC (USDA FoodData Central) ingredient matching.
 *
 * This module (`src/domain/fdc-matching/`) imports NOTHING outside itself —
 * no drizzle, no postgres, no openai (ARCHITECTURE.md's hexagonal rule).
 * `FdcRepository` is the boundary: `src/adapters/fdc-repository.ts` supplies
 * a Drizzle+pgvector implementation, but the domain function only ever sees
 * this interface, so it stays testable with a fake and swappable later.
 */

/** Exactly 3 candidates are shown to the user per ingredient (MATCH-01). */
export const CANDIDATE_COUNT = 3;

/**
 * Only these two USDA FDC data types may ever reach a user. Branded Foods
 * (~2M-row retail-label scan dataset) was never downloaded and must never
 * surface here — this allow-list is the read-path half of MATCH-02, mirrored
 * by the `fdc_foods_source_check` Postgres constraint from Plan 03 and by
 * the loader's own filtering in Plan 06/07.
 */
export const ALLOWED_SOURCES = ['foundation_food', 'sr_legacy_food'] as const;

export interface FdcCandidate {
  fdcId: number;
  /**
   * Shown verbatim to the user — never rewritten or summarized. FDC
   * descriptions encode raw/cooked/preparation state directly in the text
   * (e.g. "Chicken, broilers or fryers, breast, meat only, raw" vs
   * "... cooked, roasted"), and per 01-RESEARCH.md Pitfall 5 this is the
   * user's ONLY signal for telling those apart in Phase 4's picker.
   */
  description: string;
  source: (typeof ALLOWED_SOURCES)[number];
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  /**
   * null = "нет данных" (TECH_SPEC §5.8) — many USDA records genuinely do
   * not report sugar. Never substituted with 0 anywhere on this path.
   */
  sugarG: number | null;
  /** 1 - cosine distance. Higher is closer/more similar. */
  similarity: number;
}

export interface FdcRepository {
  /** Returns up to `limit` candidates ordered by descending similarity. */
  findNearest(embedding: number[], limit: number): Promise<FdcCandidate[]>;
}
