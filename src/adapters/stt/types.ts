/**
 * Shared speech-to-text port — used by the voice message handler (Phase 3
 * onward) to turn a Telegram voice message into text before LLM
 * decomposition. One adapter, one default model, one place that knows what
 * "transcribing audio" means for this project.
 *
 * MODEL CHOICE (D-03, 2026-08, Phase 3 planning): the owner picked
 * `gpt-4o-mini-transcribe` over the pricier `gpt-4o-transcribe` — this
 * disagreement between cost and (hypothetically) better Kazakh/mixed-speech
 * accuracy is recorded here deliberately, not resolved by opinion. It gets
 * settled empirically by `npm run verify-stt` (scripts/verify-stt.ts), which
 * transcribes the owner's own real recordings with BOTH models side by side.
 * If that comparison shows `gpt-4o-transcribe` is meaningfully better on
 * dish names (бешбармак, куырдак, etc.), change the ONE line below
 * (`STT_MODEL`) — nothing else in the codebase should hardcode a model
 * string (see the grep gate in 03-01-PLAN.md's acceptance criteria).
 */

/** The only place the runtime bot's STT model name is allowed to live. */
export const STT_MODEL = 'gpt-4o-mini-transcribe';

/**
 * Used ONLY by scripts/verify-stt.ts for the side-by-side comparison that
 * settles D-03 empirically — never used by the running bot.
 */
export const STT_COMPARISON_MODEL = 'gpt-4o-transcribe';

/**
 * Longest voice message the bot will accept (D-14). Lives here so the
 * Telegram handler and the cost estimator in the adapter share one number
 * instead of two constants that can drift apart.
 */
export const MAX_VOICE_SECONDS = 60;

export interface TranscriptionResult {
  text: string;
  /** The model actually used for this call (not necessarily STT_MODEL — see STT_COMPARISON_MODEL). */
  model: string;
  /**
   * Deliberately `unknown`: openai@7.4.0 types this as a `Tokens | Duration`
   * union whose shape depends on the model used. The port does not pretend
   * to know which variant it got — the cost-log consumer narrows it.
   */
  usage: unknown;
}

export interface Transcriber {
  /**
   * Transcribes raw audio bytes (e.g. a Telegram voice message OGG/OPUS
   * buffer) to text. `opts.prompt` is an optional glossary/context hint
   * (D-07 seam) — `undefined` by default, meaning no glossary is applied.
   */
  transcribe(audio: Buffer, opts?: { prompt?: string }): Promise<TranscriptionResult>;
}
