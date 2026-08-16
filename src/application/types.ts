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
import type { DraftAwaitingInput } from '../db/schema/diary-drafts.js';

/**
 * Re-exported from the schema so `corrections.ts`/`confirm-meal.ts`/the
 * Telegram handlers import every application-layer shape from here, the same
 * way they import `DraftComponent` and `MealDraft` — never reaching into
 * `src/db/schema/` directly for a type.
 */
export type { DraftAwaitingInput };

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
 *
 * `replyMarkup` (04-12) is an optional fourth parameter carrying an opaque
 * inline-keyboard value produced by `DraftCardRenderer` below. Telegram fact
 * that matters here: omitting `reply_markup` on an `editMessageText` call
 * LEAVES any previous keyboard in place rather than clearing it (the same
 * fact `correction.ts`'s `NO_KEYBOARD` constant documents) — so every
 * failure path in `voice-pipeline.ts`, which edits an ack message that never
 * had a keyboard, correctly passes nothing here.
 */
export interface MessageEditor {
  editMessage(chatId: number, messageId: number, text: string, replyMarkup?: unknown): Promise<void>;
}

/**
 * The text plus opaque reply markup for one rendered card (04-12).
 * `replyMarkup` is deliberately `unknown` — the application layer must stay
 * ignorant of Telegram's markup shape; it only forwards the opaque value
 * back to `MessageEditor.editMessage`.
 */
export interface RenderedCard {
  text: string;
  replyMarkup: unknown;
}

/**
 * The bot-layer port (04-12) that renders the D-01 (Phase 4) level-1
 * correction card — the meal list plus its `crc:` keyboard — WITHOUT this
 * layer ever importing grammY's `InlineKeyboard`. `src/bot/telegram/
 * draft-card-renderer.ts` supplies the only real implementation; the
 * pipeline only ever depends on this interface (mirrors `MessageEditor`
 * above).
 *
 * `renderLevel1` handles the D-12 (Phase 4) empty-component-list case
 * itself (both `buildCorrectionCard` and `buildLevel1Keyboard` already
 * branch on an empty list) — callers never special-case it.
 */
export interface DraftCardRenderer {
  renderLevel1(components: DraftComponent[], draftId: number): RenderedCard;
}

/** Every terminal, non-success outcome the voice pipeline can reach. */
export type PipelineFailure = 'stt_failed' | 'decomposition_failed' | 'no_food' | 'internal_error';

/**
 * D-11: how long a draft in `status = 'draft'` remains actionable. Past this
 * age the correction/confirm buttons on the result card stop working and the
 * user is told to resend — nothing is deleted. A `'confirmed'` draft is
 * exempt (D-06: it is now the working copy of a real diary entry, not
 * disposable state) and an `'abandoned'` one is identified by its status, not
 * by age.
 *
 * KNOWN DEBT, stated rather than glossed over: this phase does not add a
 * background job to delete abandoned/expired rows — that needs a scheduler
 * that does not exist yet — so those rows (and the transcripts they hold,
 * which are sensitive: what someone ate) persist indefinitely. Revisit once
 * a scheduler exists; do not invent an ad-hoc deletion path here.
 */
export const DRAFT_TTL_HOURS = 24;

/**
 * The single shared rule for "is this draft too old to act on" (D-11). Pure,
 * no I/O, `now` is injected rather than read via `new Date()` internally so
 * both `draft-store.test.ts` and later handler tests can use a fixed clock
 * and never disagree with the store about what "stale" means.
 *
 * Any status other than `'draft'` is never expired: a `'confirmed'` row is a
 * durable diary record (D-06) and must never expire, and an `'abandoned'`
 * row is already terminal — its status, not its age, is what matters.
 */
export function isDraftExpired(status: string, createdAt: Date, now: Date): boolean {
  if (status !== 'draft') {
    return false;
  }
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs > DRAFT_TTL_HOURS * 3600_000;
}

/**
 * The shape `draft-store.ts`'s `readDraft` returns — every column the
 * correction/confirm/delete flows (plans 07/08) and the Telegram handlers
 * (plans 09/10) need, with no leakage of Drizzle's raw row/jsonb types.
 */
export interface PersistedDraft {
  id: number;
  userId: number;
  chatId: number;
  messageId: number;
  source: 'voice' | 'text';
  transcript: string;
  /** The `components` jsonb column, cast to `DraftComponent[]`. */
  components: DraftComponent[];
  status: 'draft' | 'confirmed' | 'abandoned';
  awaitingInput: DraftAwaitingInput | null;
  /**
   * `null` means this row is a pre-Phase-4 leftover (see
   * `src/db/schema/diary-drafts.ts`'s `localDate` comment) — confirmation
   * must refuse a draft in this state rather than inventing a day for it.
   */
  localDate: string | null;
  diaryId: number | null;
  createdAt: Date;
}
