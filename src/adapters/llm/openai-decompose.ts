/**
 * OpenAI implementation of the shared `DishDecomposer` port (types.ts), via
 * the Vercel AI SDK's `generateObject` + the strict `DecompositionSchema`.
 *
 * Retry policy (DECOMP-03): the `catch` block below handles ONLY
 * `NoObjectGeneratedError.isInstance(err)` — a schema-invalid or empty/
 * malformed model response. On that one error, `decompose()` calls
 * `generate` a second time with the strict prompt variant; a second
 * `NoObjectGeneratedError` throws `DecompositionFailedError`. Every other
 * error (network, auth, quota) rethrows immediately — there is
 * deliberately NO backoff loop here: the AI SDK already retried transient
 * network/5xx failures internally (its own `maxRetries`, default 2) before
 * `NoObjectGeneratedError` could ever surface, and adding a second wrapper
 * would double-retry paid calls (03-RESEARCH.md Pitfall 5).
 *
 * A well-formed `{ items: [] }` response is a SUCCESSFUL call (D-08) — it
 * never enters the catch block and never spends the DECOMP-03 retry.
 *
 * Logging invariant: this file never logs the API key, the transcript, or
 * the model's raw output — only counts, the model name, and the error kind
 * (mirrors openai-embed.ts / openai-transcribe.ts). The transcript is
 * health data (03-CONTEXT.md, src/bot/error-handler.ts).
 */
import { generateObject, NoObjectGeneratedError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { loadEnv } from '../../config/env.js';
import { buildDecompositionPrompt } from './prompt.js';
import {
  DECOMPOSITION_MODEL,
  DecompositionFailedError,
  DecompositionSchema,
  type Decomposition,
  type DecompositionResult,
  type DishDecomposer,
} from './types.js';

/**
 * The subset of `generateObject`'s signature this adapter actually uses.
 * Accepting this as an injectable option (mirroring `createOpenAIEmbedder`'s
 * `client?:` seam and `createOpenAITranscriber`'s `client?:` seam) means no
 * test can make a network call.
 */
export interface GenerateObjectLike {
  (args: {
    model: string;
    schema: typeof DecompositionSchema;
    prompt: string;
    temperature: number;
  }): Promise<{ object: Decomposition; usage: unknown }>;
}

export interface CreateOpenAIDecomposerOptions {
  /** Defaults to loadEnv().OPENAI_API_KEY — read lazily, not at import time. */
  apiKey?: string;
  /** Defaults to DECOMPOSITION_MODEL (D-16). */
  model?: string;
  /** Injectable for tests — when supplied, no real OpenAI provider is built and no network call is possible. */
  generate?: GenerateObjectLike;
}

interface ErrorLike {
  status?: number;
  code?: string | null;
}

/** Duck-types the error shape both a real OpenAI APIError and a test fake share. */
function asErrorLike(err: unknown): ErrorLike {
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; code?: unknown };
    return {
      status: typeof e.status === 'number' ? e.status : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }
  return {};
}

/** Maps a terminal (non-schema, non-retryable) error to an owner-readable message. */
function toOwnerMessage(err: unknown): Error {
  const { status, code } = asErrorLike(err);
  const original = err instanceof Error ? err.message : String(err);

  if (code === 'insufficient_quota') {
    return new Error('на счету OpenAI закончились деньги — пополни баланс, см. план 01-02');
  }
  if (status === 401) {
    return new Error('проверь OPENAI_API_KEY в .env');
  }
  return err instanceof Error ? err : new Error(original);
}

/** Builds the real `generateObject`-backed implementation of GenerateObjectLike, given a resolved OpenAI provider. */
function createDefaultGenerate(openaiProvider: ReturnType<typeof createOpenAI>): GenerateObjectLike {
  return async ({ model, schema, prompt, temperature }) => {
    const result = await generateObject({
      model: openaiProvider(model),
      schema,
      prompt,
      temperature,
    });
    return { object: result.object, usage: result.usage };
  };
}

export function createOpenAIDecomposer(opts: CreateOpenAIDecomposerOptions = {}): DishDecomposer {
  const model = opts.model ?? DECOMPOSITION_MODEL;

  function getGenerate(): GenerateObjectLike {
    if (opts.generate) {
      return opts.generate;
    }
    const apiKey = opts.apiKey ?? loadEnv().OPENAI_API_KEY;
    const openaiProvider = createOpenAI({ apiKey });
    return createDefaultGenerate(openaiProvider);
  }

  return {
    async decompose(transcript: string): Promise<DecompositionResult> {
      const generate = getGenerate();

      async function attempt(strict: boolean): Promise<{ object: Decomposition; usage: unknown }> {
        return generate({
          model,
          schema: DecompositionSchema,
          // Low temperature reduces (does not eliminate) run-to-run
          // variation on the same input.
          prompt: buildDecompositionPrompt(transcript, strict),
          temperature: 0.1,
        });
      }

      try {
        const result = await attempt(false);
        return { decomposition: result.object, usage: result.usage, model };
      } catch (err) {
        if (!NoObjectGeneratedError.isInstance(err)) {
          throw toOwnerMessage(err);
        }
        console.error(`decomposition schema-invalid on first attempt, model=${model} — retrying once (DECOMP-03)`);
        try {
          const retryResult = await attempt(true);
          return { decomposition: retryResult.object, usage: retryResult.usage, model };
        } catch (retryErr) {
          if (NoObjectGeneratedError.isInstance(retryErr)) {
            console.error(`decomposition schema-invalid on retry, model=${model} — giving up (DECOMP-03)`);
            throw new DecompositionFailedError();
          }
          throw toOwnerMessage(retryErr);
        }
      }
    },
  };
}
