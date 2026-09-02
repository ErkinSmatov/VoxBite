/**
 * matching — the Mini App API's own construct-once wiring for the FDC
 * ingredient search, mirroring the same one-embedder-one-repository-per-
 * container invariant the bot layer's own meal-pipeline wiring follows (NOT
 * importing it — that module lives in the bot layer and this file must not
 * depend on `grammy` or anything bot-shaped).
 *
 * ONE `Embedder` and ONE `FdcRepository` per serverless container. A
 * different embedding model or dimension count than the offline FDC indexer
 * used to build `fdc_foods.embedding` would silently destroy retrieval
 * quality — there is no error, no crash, just quietly wrong ingredient
 * matches for every `add-component` call served by that warm container.
 * Building a new OpenAI client per request is pure waste on top of that
 * risk (T-04.1-24, Denial of Wallet via redundant client construction).
 *
 * Construction is LAZY, deliberately: the embedder factory reads
 * `OPENAI_API_KEY` through `loadEnv()`, and importing this module (e.g. from
 * a test) must never require a configured environment. The cache variables
 * below are only populated the first time `getMatchingDeps` actually runs,
 * inside a warm container, and are then reused for every subsequent
 * invocation of that same container.
 *
 * DEPLOYMENT NOTE for plan 13: `OPENAI_API_KEY` must be set as a Vercel
 * environment variable — `add-component` is the one endpoint in this phase
 * that spends real money on the server side.
 */
import { createOpenAIEmbedder } from '../../src/adapters/embeddings/openai-embed.js';
import type { Embedder } from '../../src/adapters/embeddings/types.js';
import { createDrizzleFdcRepository } from '../../src/adapters/fdc-repository.js';
import type { FdcRepository } from '../../src/domain/fdc-matching/index.js';
import type { Db } from './db.js';

let cached: { embedder: Embedder; repo: FdcRepository } | null = null;

/**
 * Returns the process-level `Embedder`/`FdcRepository` pair, building it
 * lazily on first call and reusing it for every later call in the same
 * warm container. Never construct a second embedder per
 * container — that is exactly the model/dimension drift risk this module
 * exists to prevent.
 */
export function getMatchingDeps(db: Db): { embedder: Embedder; repo: FdcRepository } {
  if (!cached) {
    cached = {
      embedder: createOpenAIEmbedder(),
      repo: createDrizzleFdcRepository(db),
    };
  }
  return cached;
}
