/**
 * Shared contracts for the voice pipeline orchestration layer
 * (`src/application/`), the layer that sits between the bot transport
 * (`src/bot/`) and the adapters/domain (`src/adapters/`, `src/domain/`).
 *
 * Two hard rules for everything in `src/application/`:
 * 1. This layer may import adapters, the domain, and the db schema — it must
 *    NEVER import `grammy` or any grammY type. The bot layer translates a
 *    Telegram update into a plain call into this layer, not the other way
 *    around (ARCHITECTURE.md Internal Boundaries: `bot/` <-> `application/`).
 * 2. Any state this layer produces (drafts, in-flight processing) is
 *    persisted to Postgres, never held in a module-level variable
 *    (ARCHITECTURE.md Anti-Pattern 4 — in-memory draft state is lost on
 *    restart and does not survive multi-instance scaling).
 *
 * Plans 04-08 of this phase import these types instead of inventing their
 * own shapes — this file is their single source of truth.
 */

import type { FdcCandidate } from '../domain/fdc-matching/index.js';

/**
 * Below this similarity a component's best candidate is FLAGGED, never
 * dropped (D-21) — a dropped component would make calories silently vanish
 * from a dish with no explanation to the user. `similarity` is
 * `1 - cosine distance`, so higher means closer/more similar (see
 * `FdcCandidate.similarity`).
 *
 * No prior phase established this number: 0.7 is a first guess, to be tuned
 * against real transcripts once the phase is live.
 */
export const WEAK_MATCH_SIMILARITY_THRESHOLD = 0.7;

/**
 * D-15's runaway guard: the maximum number of voice/text pipeline messages
 * one user may send in a day. This exists to catch a stuck client or a
 * client-side loop, NOT to enforce a subscription tariff — tariff limits are
 * a v2 concern (see PROJECT.md Out of Scope). Exceeding this cap produces a
 * friendly Russian message (`pipelineCopy.dailyCapReached`), never an error.
 */
export const DAILY_MESSAGE_CAP = 30;

/** One ingredient as decomposed by the LLM, before FDC matching. */
export interface DecomposedComponent {
  /** Russian name as spoken/decomposed, shown to the user. */
  component: string;
  /** English translation, used to query the (English-language) FDC index. */
  componentEn: string;
  /** LLM-estimated grams for this component. */
  grams: number;
}

/**
 * One ingredient after FDC matching: the decomposed component plus its
 * candidates and the chosen/flagged state derived from them.
 */
export interface DraftComponent extends DecomposedComponent {
  /** Up to `CANDIDATE_COUNT` (3) candidates, ordered by descending similarity. */
  candidates: FdcCandidate[];
  /** The best candidate's `fdcId`, or `null` when there were no candidates at all. */
  chosenFdcId: number | null;
  /**
   * Derived, not authored: `true` when `candidates` is empty or
   * `candidates[0].similarity < WEAK_MATCH_SIMILARITY_THRESHOLD`. Always
   * computed via `isWeakMatch` below so the pipeline and the result card can
   * never disagree about which components are flagged.
   */
  weakMatch: boolean;
}

/**
 * Computes `DraftComponent.weakMatch`. Exported so both the orchestration
 * layer (when building a `MealDraft`) and `src/bot/formatting/result-card.ts`
 * (when rendering one) derive the exact same flag from the exact same rule.
 */
export function isWeakMatch(candidates: FdcCandidate[]): boolean {
  const top = candidates[0];
  if (!top) {
    return true;
  }
  return top.similarity < WEAK_MATCH_SIMILARITY_THRESHOLD;
}

/** The full result of one voice/text message going through the pipeline. */
export interface MealDraft {
  /** The STT transcript (source: 'voice') or the raw text (source: 'text'). */
  transcript: string;
  source: 'voice' | 'text';
  components: DraftComponent[];
}

/**
 * The port that lets the Telegram-agnostic pipeline replace the
 * "Секунду, разбираю 🎧" acknowledgement message with its eventual result
 * (D-13), without importing grammY. `src/bot/` supplies the grammY-backed
 * implementation (plan 03-07); the orchestration layer only ever depends on
 * this interface.
 */
export interface MessageEditor {
  editMessage(chatId: number, messageId: number, text: string): Promise<void>;
}

/** Every terminal, non-success outcome the voice pipeline can reach. */
export type PipelineFailure = 'stt_failed' | 'decomposition_failed' | 'no_food' | 'internal_error';
