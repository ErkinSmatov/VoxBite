/**
 * correction-wiring — the composition-root helper that turns raw runtime
 * deps into the `CorrectionHandlerDeps` plan 09/10's handlers expect,
 * mirroring `pipeline-wiring.ts`'s construct-once discipline: never build an
 * `Embedder`/`FdcRepository` per update.
 *
 * ONE embedder instance per process (01-CONTEXT.md's embedding invariant): a
 * different embedding model/dimension count for added components than the
 * offline FDC indexer used would silently destroy retrieval quality for
 * `➕ Добавить` while everything still "worked" — no error, just quietly
 * wrong matches. The caller (`bot.ts`) is expected to pass in the SAME
 * `embedder`/`repo` instances `buildMealHandlerDeps` (pipeline-wiring.ts)
 * already built for the voice/text pipeline (`mealDeps.deps.embedder` /
 * `mealDeps.deps.repo`) rather than let this file construct a second pair —
 * `embedder`/`repo` are accepted as pass-through parameters here for exactly
 * that reason. The `createEmbedder`/`createRepository` factories (same
 * functions `pipeline-wiring.ts` uses, same zero-argument defaults) exist
 * only as the fallback for a caller that has no `mealDeps` to reuse (e.g. a
 * standalone script or a future entrypoint), and for tests that want to
 * inject fakes without touching `pipeline-wiring.ts` at all.
 *
 * Lives in its own file, not inline in `bot.ts`, for the same reason
 * `pipeline-wiring.ts` does: `bot.ts`'s module doc comment forbids that file
 * from reading env or building infrastructure.
 */
import { createOpenAIEmbedder } from '../adapters/embeddings/openai-embed.js';
import type { Embedder } from '../adapters/embeddings/types.js';
import { createDrizzleFdcRepository } from '../adapters/fdc-repository.js';
import type { Db } from '../db/client.js';
import type { FdcRepository } from '../domain/fdc-matching/index.js';
import type { CorrectionHandlerDeps } from './handlers/correction.js';

export interface CorrectionWiringFactories {
  createEmbedder: typeof createOpenAIEmbedder;
  createRepository: typeof createDrizzleFdcRepository;
}

export interface CorrectionWiringDeps {
  db: Db;
  /**
   * Reuse `buildMealHandlerDeps`'s already-constructed collaborators
   * (`mealDeps.deps.embedder` / `mealDeps.deps.repo`) — the intended runtime
   * shape, so only ONE `Embedder`/`FdcRepository` pair exists per process.
   * Omit only when there is no `mealDeps` to reuse from (falls back to the
   * factories below, constructing a fresh pair).
   */
  embedder?: Embedder;
  repo?: FdcRepository;
  /** Injectable for tests — defaults to the real factories, never called with a network-capable client in a test. */
  factories?: Partial<CorrectionWiringFactories>;
}

/**
 * Constructs `CorrectionHandlerDeps` exactly once at startup. Do NOT call
 * this per update — see the module header.
 */
export function buildCorrectionHandlerDeps(w: CorrectionWiringDeps): CorrectionHandlerDeps {
  const createEmbedder = w.factories?.createEmbedder ?? createOpenAIEmbedder;
  const createRepository = w.factories?.createRepository ?? createDrizzleFdcRepository;

  const embedder = w.embedder ?? createEmbedder();
  const repo = w.repo ?? createRepository(w.db);

  return { db: w.db, embedder, repo };
}
