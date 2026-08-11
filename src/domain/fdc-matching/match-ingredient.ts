/**
 * Pure top-N FDC candidate selection (MATCH-01/MATCH-02 domain contract).
 *
 * Owns WHICH candidates to keep, never HOW the search executes — the vector
 * search itself lives entirely in the injected `FdcRepository`
 * (src/adapters/fdc-repository.ts). This function does no nutrient math, no
 * de-duplication, and no diversity/MMR re-ranking (01-RESEARCH.md Pitfall 6
 * explicitly scopes MMR re-ranking OUT of this phase — near-duplicate
 * candidates are a known, accepted limitation here).
 */
import { ALLOWED_SOURCES, CANDIDATE_COUNT, type FdcCandidate, type FdcRepository } from './types.js';

/**
 * Must equal src/adapters/embeddings/types.ts's EMBEDDING_DIMENSIONS and the
 * vector(1536) column in src/db/schema/fdc-foods.ts. Duplicated as a literal
 * (not imported) so this module keeps zero imports outside itself — the
 * hexagonal rule (ARCHITECTURE.md) forbids the domain layer reaching into
 * src/adapters/, even for a constant.
 */
const EXPECTED_EMBEDDING_DIMENSIONS = 1536;

export interface MatchIngredientArgs {
  embedding: number[];
  repo: FdcRepository;
  /** Defaults to CANDIDATE_COUNT (3). */
  topN?: number;
}

function assertValidEmbedding(embedding: number[]): void {
  if (embedding.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Invalid embedding length: expected ${EXPECTED_EMBEDDING_DIMENSIONS}, got ${embedding.length}.`,
    );
  }
  if (!embedding.every((n) => Number.isFinite(n))) {
    throw new Error('Invalid embedding: all values must be finite numbers.');
  }
}

const ALLOWED_SOURCE_SET: ReadonlySet<string> = new Set(ALLOWED_SOURCES);

export async function matchIngredient(args: MatchIngredientArgs): Promise<FdcCandidate[]> {
  const { embedding, repo } = args;
  const topN = args.topN ?? CANDIDATE_COUNT;

  if (!Number.isInteger(topN) || topN < 1) {
    throw new Error(`Invalid topN: must be an integer >= 1, got ${topN}.`);
  }

  // Validate BEFORE calling the repository — a malformed embedding must
  // never reach the (expensive, real) vector search.
  assertValidEmbedding(embedding);

  // Over-fetch by 2x so that filtering out a disallowed source (defence in
  // depth — the loader already guarantees ALLOWED_SOURCES, this guarantees
  // it again at the read path) still leaves enough candidates to fill topN.
  const rows = await repo.findNearest(embedding, topN * 2);

  const allowed = rows.filter((c) => ALLOWED_SOURCE_SET.has(c.source));

  // No rounding, no nutrient math, no de-duplication — candidates pass
  // through unchanged other than filter + sort + slice.
  return [...allowed].sort((a, b) => b.similarity - a.similarity).slice(0, topN);
}
