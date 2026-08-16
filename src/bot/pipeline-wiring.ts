/**
 * pipeline-wiring — the composition-root helper that turns raw runtime deps
 * (a `Db`, a bot token, a grammY `Api`) into the real `MealHandlerDeps` plan
 * 03-07's handlers expect. Lives in its own file, not inline in `bot.ts`,
 * because `bot.ts`'s module doc comment forbids that file from reading env
 * or building infrastructure — keeping that true is what lets a future
 * webhook entrypoint reuse `createBot()` unchanged (D-09).
 *
 * Logging invariant: `resolveSttModel`'s warning line echoes the raw
 * override string the owner typed into `.env` — that is a model name, not a
 * secret, and it is intentional (fastest possible diagnosis of a typo).
 * Nothing else in this file logs anything.
 */
import { createOpenAITranscriber } from '../adapters/stt/openai-transcribe.js';
import { STT_COMPARISON_MODEL, STT_MODEL } from '../adapters/stt/types.js';
import { createOpenAIDecomposer } from '../adapters/llm/openai-decompose.js';
import { createOpenAIEmbedder } from '../adapters/embeddings/openai-embed.js';
import { createDrizzleFdcRepository } from '../adapters/fdc-repository.js';
import type { Db } from '../db/client.js';
import type { PipelineDeps } from '../application/voice-pipeline.js';
import type { MealHandlerDeps } from './handlers/meal.js';
import { createMessageEditor, type EditableApi } from './telegram/message-editor.js';
import { createDraftCardRenderer } from './telegram/draft-card-renderer.js';

/**
 * Resolves the raw `.env` override (already trimmed of surrounding
 * whitespace) against the two model names `src/adapters/stt/types.ts`
 * exports — never against string literals, so D-03's single-constant rule
 * survives here too. An empty or unrecognised override always falls back to
 * the cheaper `STT_MODEL`; T-03-48's mitigation is that this function can
 * only ever produce a CHEAPER-than-intended result, never a more expensive
 * one.
 */
export function resolveSttModel(rawOverride: string): string {
  const trimmed = rawOverride.trim();
  if (trimmed === '') {
    return STT_MODEL;
  }
  if (trimmed === STT_COMPARISON_MODEL) {
    return STT_COMPARISON_MODEL;
  }
  console.log(
    `pipeline-wiring: STT_MODEL="${trimmed}" не распознан, допустимы только ` +
      `"${STT_MODEL}" и "${STT_COMPARISON_MODEL}" — использую дешёвую модель по умолчанию.`,
  );
  return STT_MODEL;
}

export interface MealWiringFactories {
  createTranscriber: typeof createOpenAITranscriber;
  createDecomposer: typeof createOpenAIDecomposer;
  createEmbedder: typeof createOpenAIEmbedder;
  createRepository: typeof createDrizzleFdcRepository;
  createEditor: typeof createMessageEditor;
}

export interface MealWiringDeps {
  db: Db;
  token: string;
  api: EditableApi;
  sttModel: string;
  /** Injectable for tests — defaults to the real factories, never called with a network-capable client in a test. */
  factories?: Partial<MealWiringFactories>;
}

/**
 * Constructs every collaborator `processMeal` needs exactly once — building
 * a new OpenAI client per voice message would be pure waste. Do NOT pass a
 * different embedding model or dimension count to `createOpenAIEmbedder`
 * here than the offline indexer used: a mismatch silently destroys
 * retrieval quality (03-CONTEXT.md).
 */
export function buildMealHandlerDeps(w: MealWiringDeps): MealHandlerDeps {
  const createTranscriber = w.factories?.createTranscriber ?? createOpenAITranscriber;
  const createDecomposer = w.factories?.createDecomposer ?? createOpenAIDecomposer;
  const createEmbedder = w.factories?.createEmbedder ?? createOpenAIEmbedder;
  const createRepository = w.factories?.createRepository ?? createDrizzleFdcRepository;
  const createEditor = w.factories?.createEditor ?? createMessageEditor;

  const transcriber = createTranscriber({ model: resolveSttModel(w.sttModel) });
  const decomposer = createDecomposer();
  const embedder = createEmbedder();
  const repo = createRepository(w.db);
  const editor = createEditor(w.api);
  const cardRenderer = createDraftCardRenderer();

  const deps: PipelineDeps = { db: w.db, transcriber, decomposer, embedder, repo, editor, cardRenderer };

  return { db: w.db, token: w.token, deps };
}
