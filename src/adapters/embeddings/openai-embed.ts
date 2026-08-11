/**
 * OpenAI implementation of the shared `Embedder` port (types.ts).
 *
 * Batches at EMBEDDING_BATCH_SIZE (100), issues calls SEQUENTIALLY (never
 * `Promise.all`) — parallel bursts are exactly what overshoots the not
 * -instantaneous OpenAI spend limit (01-RESEARCH.md Pitfall 7), reassembles
 * results by `data[j].index` so a shuffled response never mismatches inputs,
 * and fails fast with owner-readable Russian messages on quota/auth errors
 * instead of silently retrying money away.
 */
import OpenAI from 'openai';
import { loadEnv } from '../../config/env.js';
import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, type Embedder } from './types.js';

export interface OpenAILike {
  embeddings: {
    create(args: { model: string; input: string[]; dimensions?: number }): Promise<{
      data: { index: number; embedding: number[] }[];
    }>;
  };
}

export interface CreateOpenAIEmbedderOptions {
  /** Defaults to loadEnv().OPENAI_API_KEY — read lazily, not at import time. */
  apiKey?: string;
  /** Injectable for tests — when supplied, no real OpenAI client is built and no network call is possible. */
  client?: OpenAILike;
  batchSize?: number;
  maxRetries?: number;
}

const BACKOFF_MS = [1000, 2000, 4000];

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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

/**
 * Calls `embeddings.create` for one batch, retrying on 429 (excluding
 * insufficient_quota) and 5xx with exponential backoff. Never logs the API
 * key or the embedded text — only counts and batch indexes (T-01-25).
 */
async function embedBatchWithRetry(
  client: OpenAILike,
  batch: string[],
  batchIndex: number,
  maxRetries: number,
): Promise<{ index: number; embedding: number[] }[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
      });
      return response.data;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxRetries) {
        console.error(`embedding batch ${batchIndex} failed after ${attempt + 1} attempt(s)`);
        throw toOwnerMessage(err);
      }
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 4000;
      console.error(`embedding batch ${batchIndex} attempt ${attempt + 1} failed, retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  // Unreachable — loop always returns or throws — but keeps TS happy.
  throw toOwnerMessage(lastErr);
}

export function createOpenAIEmbedder(opts: CreateOpenAIEmbedderOptions = {}): Embedder {
  const batchSize = opts.batchSize ?? EMBEDDING_BATCH_SIZE;
  const maxRetries = opts.maxRetries ?? 3;

  function getClient(): OpenAILike {
    if (opts.client) {
      return opts.client;
    }
    const apiKey = opts.apiKey ?? loadEnv().OPENAI_API_KEY;
    return new OpenAI({ apiKey }) as unknown as OpenAILike;
  }

  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      const client = getClient();
      const batches = chunk(texts, batchSize);
      const results: number[][] = new Array(texts.length);

      for (let b = 0; b < batches.length; b += 1) {
        const batch = batches[b] as string[];
        const data = await embedBatchWithRetry(client, batch, b, maxRetries);
        const offset = b * batchSize;
        for (const item of data) {
          if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new Error(
              `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${item.embedding.length}.`,
            );
          }
          results[offset + item.index] = item.embedding;
        }
      }

      return results;
    },
  };
}

/**
 * Rough pre-flight cost estimate BEFORE spending anything — CLAUDE.md
 * requires explaining paid actions in advance, not after. `tokens ≈
 * chars/4` is the standard rough English-text heuristic; price is
 * $0.13 per 1M tokens for text-embedding-3-large (regardless of the
 * `dimensions` truncation parameter — OpenAI bills on input tokens, not
 * output vector size).
 */
export function estimateEmbeddingCostUsd(texts: string[]): number {
  const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
  const estimatedTokens = totalChars / 4;
  const usdPerMillionTokens = 0.13;
  return (estimatedTokens / 1_000_000) * usdPerMillionTokens;
}
