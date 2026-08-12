/**
 * cost-log — the D-17 per-processed-message operator signal: exactly ONE
 * line, printed to the terminal the owner already has open, so an anomaly
 * (a runaway prompt, an unexpectedly long voice message) is visible the
 * same day instead of at the end of the month.
 *
 * This deliberately is NOT: a spend table, a dashboard, or a persisted
 * ledger. A real, persisted ledger for unit economics waits for the payment
 * milestone (see PROJECT.md Constraints — payments are a later phase). This
 * module's only job is a rough, same-day operator signal.
 *
 * `CostInputs` structurally cannot carry a transcript or a component name —
 * there is no field for either. That is the actual enforcement mechanism
 * for "the cost line never leaks health data" (T-03-30): a field that does
 * not exist cannot be interpolated into the line by accident, no matter what
 * future code touches this file.
 *
 * Zero grammY imports, zero I/O other than `console.log` in `logCost`.
 */

/**
 * LLM ($ per 1M tokens, gpt-4o-mini). Sourced from aggregator pricing pages
 * recorded in 03-RESEARCH.md — re-check against platform.openai.com/pricing
 * before trusting this for anything beyond a rough operator signal.
 */
const LLM_INPUT_USD_PER_MILLION_TOKENS = 0.15;
const LLM_OUTPUT_USD_PER_MILLION_TOKENS = 0.6;

/**
 * Embeddings ($ per 1M tokens, text-embedding-3-large) — mirrors the price
 * constant in src/adapters/embeddings/openai-embed.ts's
 * `estimateEmbeddingCostUsd`. That function needs the actual embedded
 * strings to estimate a token count; `CostInputs` intentionally carries none
 * of that content (only a count), so this module uses a rough
 * average-tokens-per-short-food-name constant instead. This is a coarser
 * estimate than `estimateEmbeddingCostUsd`'s char-based one on purpose — the
 * tradeoff for never letting a component name anywhere near this file.
 */
const EMBEDDING_USD_PER_MILLION_TOKENS = 0.13;
const AVG_TOKENS_PER_EMBEDDED_STRING = 6;

export interface CostInputs {
  /** Audio duration in seconds, or `null` for a text-input run (no STT call happened). */
  sttSeconds: number | null;
  /** Raw usage value from the Transcriber port — narrowed defensively, never trusted blindly. */
  sttUsage: unknown;
  /** The STT model actually used, or `null` when sttSeconds is `null`. */
  sttModel: string | null;
  /** Raw usage value from DecompositionResult.usage (AI SDK v7 `LanguageModelUsage`-shaped). */
  llmUsage: unknown;
  llmModel: string;
  /** How many strings were sent to Embedder.embed() in the one batched call. */
  embeddedCount: number;
  /** How many DraftComponents ended up in the draft. */
  componentCount: number;
}

interface TokenCounts {
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Narrows an `unknown` usage value against the AI SDK v7 `LanguageModelUsage`
 * shape (`inputTokens`/`outputTokens`, both `number | undefined`) WITHOUT
 * assuming that shape blindly — a cost line must never be able to break a
 * user's meal analysis by throwing on an unrecognised value. Anything that
 * doesn't look like the expected shape degrades to `{ null, null }`, which
 * the caller renders as "неизвестно".
 */
function narrowTokenUsage(usage: unknown): TokenCounts {
  if (usage === null || typeof usage !== 'object') {
    return { inputTokens: null, outputTokens: null };
  }
  const u = usage as Record<string, unknown>;
  const inputTokens = typeof u.inputTokens === 'number' ? u.inputTokens : null;
  const outputTokens = typeof u.outputTokens === 'number' ? u.outputTokens : null;
  return { inputTokens, outputTokens };
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(6)}`;
}

/**
 * Pure — asserted directly on its return value, no stdout capture needed.
 * Returns a single line (no newline characters) with no user content.
 */
export function buildCostLine(inputs: CostInputs): string {
  const { sttSeconds, sttModel, llmUsage, llmModel, embeddedCount, componentCount } = inputs;

  let sttCostUsd = 0;
  let sttPart: string;
  if (sttSeconds === null || sttModel === null) {
    sttPart = 'STT: нет (текстовый ввод)';
  } else {
    // model === STT_COMPARISON_MODEL is $0.006/min, everything else $0.003/min —
    // mirror openai-transcribe.ts's estimateTranscriptionCostUsd pricing without
    // importing it (that function lives in the STT adapter, this module stays
    // adapter-agnostic and takes the already-computed seconds/model instead).
    const usdPerMinute = sttModel === 'gpt-4o-transcribe' ? 0.006 : 0.003;
    sttCostUsd = (sttSeconds / 60) * usdPerMinute;
    sttPart = `STT: ${sttSeconds.toFixed(1)}с (${sttModel}, ${formatUsd(sttCostUsd)})`;
  }

  const { inputTokens, outputTokens } = narrowTokenUsage(llmUsage);
  let llmCostUsd = 0;
  let llmPart: string;
  if (inputTokens === null && outputTokens === null) {
    llmPart = `LLM (${llmModel}): токены неизвестно`;
  } else {
    const inTok = inputTokens ?? 0;
    const outTok = outputTokens ?? 0;
    llmCostUsd =
      (inTok / 1_000_000) * LLM_INPUT_USD_PER_MILLION_TOKENS +
      (outTok / 1_000_000) * LLM_OUTPUT_USD_PER_MILLION_TOKENS;
    llmPart = `LLM (${llmModel}): in=${inTok} out=${outTok} (${formatUsd(llmCostUsd)})`;
  }

  const embeddingCostUsd =
    (embeddedCount * AVG_TOKENS_PER_EMBEDDED_STRING / 1_000_000) * EMBEDDING_USD_PER_MILLION_TOKENS;
  const embedPart = `embeddings: ${embeddedCount} шт (~${formatUsd(embeddingCostUsd)})`;

  const totalUsd = sttCostUsd + llmCostUsd + embeddingCostUsd;

  return (
    `${sttPart} | ${llmPart} | ${embedPart} | компонентов: ${componentCount} | ` +
    `итого (примерно): ${formatUsd(totalUsd)}`
  );
}

/** Thin console.log wrapper — one call, one line, per processed message. */
export function logCost(inputs: CostInputs): void {
  console.log(buildCostLine(inputs));
}
