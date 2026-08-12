/**
 * OpenAI implementation of the shared `Transcriber` port (types.ts).
 *
 * Sends the raw audio Buffer to OpenAI's audio transcription endpoint via
 * `toFile()` — never touches disk (D-05), retries 429/5xx with exponential
 * backoff, and fails fast with owner-readable Russian messages on
 * quota/auth errors instead of silently retrying money away.
 *
 * Logging invariant: this file never logs the API key, the audio bytes, or
 * the transcript text — only counts, model names, status codes and error
 * kinds (mirrors openai-embed.ts's "never logs the API key or the embedded
 * text" line and src/bot/error-handler.ts's rule).
 */
import OpenAI, { toFile } from 'openai';
import { loadEnv } from '../../config/env.js';
import { STT_COMPARISON_MODEL, STT_MODEL, type Transcriber } from './types.js';

export interface OpenAITranscribeLike {
  audio: {
    transcriptions: {
      create(args: { file: unknown; model: string; prompt?: string }): Promise<{
        text: string;
        usage?: unknown;
      }>;
    };
  };
}

export interface CreateOpenAITranscriberOptions {
  /** Defaults to loadEnv().OPENAI_API_KEY — read lazily, not at import time. */
  apiKey?: string;
  /** Injectable for tests — when supplied, no real OpenAI client is built and no network call is possible. */
  client?: OpenAITranscribeLike;
  /** Defaults to STT_MODEL. Pass STT_COMPARISON_MODEL for the verify-stt side-by-side comparison (D-03). */
  model?: string;
  maxRetries?: number;
}

const BACKOFF_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function isRetryable(err: unknown): boolean {
  const { status, code } = asErrorLike(err);
  if (code === 'insufficient_quota') return false;
  if (status === 401) return false;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

/** Maps a terminal (non-retryable, or retries-exhausted) error to an owner-readable message. */
function toOwnerMessage(err: unknown): Error {
  const { status, code } = asErrorLike(err);
  const original = err instanceof Error ? err.message : String(err);

  if (code === 'insufficient_quota') {
    return new Error(
      'на счету OpenAI закончились деньги — пополни баланс, см. план 01-02',
    );
  }
  if (status === 401) {
    return new Error('проверь OPENAI_API_KEY в .env');
  }
  return err instanceof Error ? err : new Error(original);
}

export function createOpenAITranscriber(opts: CreateOpenAITranscriberOptions = {}): Transcriber {
  const model = opts.model ?? STT_MODEL;
  const maxRetries = opts.maxRetries ?? 3;

  function getClient(): OpenAITranscribeLike {
    if (opts.client) {
      return opts.client;
    }
    const apiKey = opts.apiKey ?? loadEnv().OPENAI_API_KEY;
    return new OpenAI({ apiKey }) as unknown as OpenAITranscribeLike;
  }

  return {
    async transcribe(audio, transcribeOpts) {
      const client = getClient();
      const file = await toFile(audio, 'voice.ogg', { type: 'audio/ogg' });

      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const result = await client.audio.transcriptions.create({
            file,
            model,
            // D-07: seam for a glossary prompt, starts empty/undefined.
            prompt: transcribeOpts?.prompt,
            // response_format defaults to 'json' for gpt-4o(-mini)-transcribe —
            // 'verbose_json' is NOT supported by these models.
          });
          return { text: result.text, model, usage: result.usage };
        } catch (err) {
          lastErr = err;
          if (!isRetryable(err) || attempt === maxRetries) {
            console.error(`STT transcription failed after ${attempt + 1} attempt(s), model=${model}`);
            throw toOwnerMessage(err);
          }
          const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 4000;
          console.error(`STT transcription attempt ${attempt + 1} failed (model=${model}), retrying in ${delay}ms`);
          await sleep(delay);
        }
      }
      // Unreachable — loop always returns or throws — but keeps TS happy.
      throw toOwnerMessage(lastErr);
    },
  };
}

/**
 * Rough pre-flight cost estimate BEFORE spending anything — CLAUDE.md
 * requires explaining paid actions in advance, not after. Prices are the
 * per-minute rates from aggregator sources recorded in 03-RESEARCH.md and
 * should be re-checked against platform.openai.com/pricing; this is a rough
 * operator signal (D-17), not accounting.
 */
export function estimateTranscriptionCostUsd(seconds: number, model: string): number {
  const usdPerMinute = model === STT_COMPARISON_MODEL ? 0.006 : 0.003;
  const minutes = seconds / 60;
  return minutes * usdPerMinute;
}
