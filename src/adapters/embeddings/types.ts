/**
 * Shared embedding port — used by the offline FDC indexer (scripts/index-fdc)
 * AND, from Phase 3 onward, by runtime ingredient matching. One adapter, one
 * model, one place that knows what "an embedding" means for this project.
 *
 * IMPORTANT: `EMBEDDING_DIMENSIONS` (1536) must stay in sync with the
 * `vector(1536)` column defined in `src/db/schema/fdc-foods.ts`. If you ever
 * change `EMBEDDING_MODEL`, every row in `fdc_foods` must be re-embedded and
 * re-indexed — do not just flip the constant. The `embedding_model_version`
 * column recorded on every row exists precisely so a stale/mixed index can
 * be detected (see scripts/index-fdc/load.ts `loadExistingVersions`)
 * instead of silently mixing incompatible vectors in one HNSW index.
 */

/** Must match the model scripts/check-setup.ts already validates against. */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/** Must equal the `vector(1536)` dimension in src/db/schema/fdc-foods.ts. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Max texts per embeddings.create() call. Capped at 100 so a runaway loop
 * (e.g. a bug that iterates per-record instead of per-batch) cannot fire
 * thousands of individual API calls before anyone notices — see
 * 01-RESEARCH.md Pitfall 7 (spend limit is not instantaneous).
 */
export const EMBEDDING_BATCH_SIZE = 100;

export interface Embedder {
  /**
   * Returns one vector per input text, in the SAME order as `texts`.
   * `embed([])` must return `[]` and make zero API calls.
   */
  embed(texts: string[]): Promise<number[][]>;
}
