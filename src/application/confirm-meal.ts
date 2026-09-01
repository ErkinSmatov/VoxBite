/**
 * confirm-meal — turns a confirmed draft into a durable `diary` row, keeps
 * an already-saved entry editable through the same machinery, and deletes
 * one for real when the user asks twice. This is the plan where the product
 * becomes trustworthy per PROJECT.md's Core Value: every number written
 * here comes from `calculateTotal()` — the SAME function that drew the `≈`
 * preview on the correction card — and every absent nutrient stays `null`
 * rather than becoming a comfortable-looking `0`. Adding a second
 * summation anywhere is the specific failure D-03 forbids.
 *
 * Implements D-05 (editing a saved entry re-runs the same correction
 * machinery over the same draft row), D-06 (the diary<->draft back-link,
 * set immediately after insert), D-07 (the diary day is frozen at message
 * receipt and NEVER recomputed — see `recomputeSavedEntry`'s comment), D-08
 * (a real, permanent delete, only after an explicit second confirmation —
 * no reversible-flag column), and D-10 (confirmation is refused while any
 * component has no FDC match at all).
 *
 * Two hard rules restated from `src/application/types.ts` (this file is
 * `src/application/`, so both apply): never import `grammy`, and never hold
 * module-level state — every function below takes `db` and reads/writes
 * Postgres, nothing is cached here.
 *
 * IDOR RULE (same as `draft-store.ts`): a `draftId` arriving from Telegram
 * `callback_data` is user-controlled input, never authorization. Every read
 * goes through `draft-store.ts`'s user-scoped helpers, and every direct
 * `diary` UPDATE/DELETE in this file is filtered by
 * `and(eq(diary.id, ...), eq(diary.userId, userId))` (or carries `userId`
 * on insert) — there is no unscoped overload.
 *
 * LOGGING RULE: nothing in this file logs transcript, description or
 * component text — only the operation name and the draft/diary id (the
 * `voice-pipeline.ts` logging invariant, T-04-07).
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diary } from '../db/schema/diary.js';
import { calculateTotal, type TotalInputItem } from '../domain/nutrition/index.js';
import {
  claimAbandon,
  claimConfirm,
  linkDiaryRow,
  markDraftStatus,
  readDraft,
} from './draft-store.js';
import { isDraftExpired, type DraftComponent, type PersistedDraft } from './types.js';

/** `diary.description` is `notNull` — descriptions never exceed this length. */
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * Neutral fallback label for the rare case where both the draft's
 * transcript AND every component name are empty/whitespace. Kept local to
 * this module — the Mini App's own frontend copy owns the equivalent
 * user-facing string on its side, not `src/application/`.
 */
const NEUTRAL_DESCRIPTION_FALLBACK = 'Приём пищи';

/**
 * D-10: the first component with no FDC match at all (`chosenFdcId ===
 * null`), or `null` when every component has a match. Deliberately
 * NARROWER than D-21 (weak-match flagging): a WEAK match confirms freely
 * (it is flagged, and the picker is one tap away); only a MISSING match
 * blocks. Exported so the Mini App API's confirm endpoint can render its own
 * "blocked confirm" copy from the same rule this module enforces.
 */
export function findBlockingComponent(components: DraftComponent[]): DraftComponent | null {
  return components.find((component) => component.chosenFdcId === null) ?? null;
}

/**
 * The trimmed transcript, bounded to `MAX_DESCRIPTION_LENGTH`, falling back
 * to the component names joined with ', ' when the transcript is empty or
 * whitespace-only, and finally to a fixed neutral label when both sources
 * are empty. `diary.description` is `notNull`, so this must never return an
 * empty string.
 */
export function buildDiaryDescription(draft: PersistedDraft): string {
  const trimmedTranscript = draft.transcript.trim();
  if (trimmedTranscript.length > 0) {
    return trimmedTranscript.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  const names = draft.components.map((component) => component.component.trim()).filter((name) => name.length > 0);
  if (names.length > 0) {
    return names.join(', ').slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return NEUTRAL_DESCRIPTION_FALLBACK;
}

/** Pairs each component's grams with the per-100g values of its chosen FDC candidate. */
function toTotalInputItems(components: DraftComponent[]): TotalInputItem[] {
  return components.map((component) => {
    const chosen = component.candidates.find((candidate) => candidate.fdcId === component.chosenFdcId) ?? null;
    return {
      grams: component.grams,
      kcal: chosen ? chosen.kcal : null,
      proteinG: chosen ? chosen.proteinG : null,
      fatG: chosen ? chosen.fatG : null,
      carbsG: chosen ? chosen.carbsG : null,
      sugarG: chosen ? chosen.sugarG : null,
    };
  });
}

export type ConfirmMealResult =
  | { ok: true; diaryId: number; localDate: string; components: DraftComponent[] }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'expired'
        | 'no_local_date'
        | 'empty'
        | 'blocked'
        | 'already_confirmed'
        | 'write_failed';
      blockedComponent?: string;
    };

/**
 * CORRECT-02/CALC-01/DIARY-01: turns a confirmed draft into exactly one
 * `diary` row.
 *
 * Order of operations (this order IS the correctness story, per
 * 04-08-PLAN.md — do not reorder):
 * 1. `readDraft`, scoped by userId (`null` -> `not_found`; this also covers
 *    a draft belonging to another user, since IDOR scoping never reveals
 *    the difference).
 * 2. `isDraftExpired` -> `expired`.
 * 3. Zero components -> `empty` (D-12: the empty state can never reach the
 *    diary).
 * 4. `findBlockingComponent` non-null -> `blocked`, naming the component
 *    (D-10).
 * 5. `localDate === null` -> `no_local_date` (a pre-Phase-4 leftover — see
 *    plan 01's schema contract; there is no honest day to invent one for).
 * 6. `claimConfirm`, the compare-and-swap (Pitfall 3). `false` means a
 *    concurrent tap already confirmed this draft — that is a no-op outcome
 *    (`already_confirmed`), NOT an error, and no second diary row is ever
 *    inserted.
 * 7. Build `TotalInputItem[]`, call `calculateTotal` (the ONLY summation on
 *    this path), and INSERT into `diary` with `localDate` copied verbatim
 *    from the draft (never recomputed — D-07/Pitfall 4) and every nutrient
 *    value passed through AS-IS, including `null` (CALC-02 — never
 *    coalesced to 0).
 * 8. `linkDiaryRow` (D-06's back-reference). A failure here is logged and
 *    swallowed — the user's entry already exists and the result must not
 *    flip to an error (the `cardDelivered` guard philosophy from
 *    `voice-pipeline.ts`).
 *
 * If the INSERT itself throws after `claimConfirm` already succeeded, the
 * draft is reverted to `'draft'` via `markDraftStatus` before returning
 * `write_failed`, so the user can retry the button instead of being stuck
 * with a confirmed draft that has no diary row — the one place a plain
 * conditional UPDATE is not sufficient on its own.
 */
export async function confirmMeal(
  db: Db,
  draftId: number,
  userId: number,
  now: Date = new Date(),
): Promise<ConfirmMealResult> {
  const draft = await readDraft(db, draftId, userId);
  if (!draft) {
    return { ok: false, reason: 'not_found' };
  }

  if (isDraftExpired(draft.status, draft.createdAt, now)) {
    return { ok: false, reason: 'expired' };
  }

  if (draft.components.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  const blocking = findBlockingComponent(draft.components);
  if (blocking) {
    return { ok: false, reason: 'blocked', blockedComponent: blocking.component };
  }

  const localDate = draft.localDate;
  if (localDate === null) {
    return { ok: false, reason: 'no_local_date' };
  }

  const claimed = await claimConfirm(db, draftId, userId);
  if (!claimed) {
    return { ok: false, reason: 'already_confirmed' };
  }

  try {
    const total = calculateTotal(toTotalInputItems(draft.components));

    const inserted = await db
      .insert(diary)
      .values({
        userId,
        localDate,
        description: buildDiaryDescription(draft),
        kcal: total.kcal,
        proteinG: total.proteinG,
        fatG: total.fatG,
        carbsG: total.carbsG,
        sugarG: total.sugarG,
        draftId,
      })
      .returning({ id: diary.id });

    const diaryRow = inserted[0];
    if (!diaryRow) {
      throw new Error('confirmMeal: diary insert returned no row');
    }

    try {
      await linkDiaryRow(db, draftId, userId, diaryRow.id);
    } catch {
      console.error(`confirm-meal: failed to link diary row back to draft ${draftId}`);
    }

    return { ok: true, diaryId: diaryRow.id, localDate, components: draft.components };
  } catch {
    try {
      await markDraftStatus(db, draftId, userId, 'draft');
    } catch {
      console.error(`confirm-meal: failed to revert draft ${draftId} to 'draft' after a failed insert`);
    }
    console.error(`confirm-meal: diary insert failed for draft ${draftId}`);
    return { ok: false, reason: 'write_failed' };
  }
}

export type RecomputeSavedEntryResult =
  | { ok: true; diaryId: number }
  | { ok: false; reason: 'not_found' | 'not_saved' | 'blocked'; blockedComponent?: string };

/**
 * CORRECT-08: the edit path for an already-saved entry. Reads the scoped
 * draft; requires `status === 'confirmed'` and `diaryId !== null`
 * (`not_saved` otherwise); runs `findBlockingComponent` (a saved entry must
 * not be edited INTO an untrustworthy state either — `blocked` otherwise);
 * recomputes with `calculateTotal` and UPDATEs the linked `diary` row's
 * nutrient columns plus `description`, scoped by
 * `and(eq(diary.id, ...), eq(diary.userId, userId))`.
 *
 * Deliberately does NOT touch `localDate` (D-07/Pitfall 4) — editing
 * yesterday's entry today must never migrate it to another day. There is no
 * second edit code path: `corrections.ts` (plan 07) mutates the same draft
 * row this function reads; this function only re-derives the diary
 * snapshot afterwards (D-05/D-06).
 */
export async function recomputeSavedEntry(
  db: Db,
  draftId: number,
  userId: number,
  // Accepted for interface parity with confirmMeal/deleteSavedEntry and
  // plan 09's call sites; unused here because a confirmed draft is never
  // subject to the D-11 expiry check (isDraftExpired's own exemption).
  _now: Date = new Date(),
): Promise<RecomputeSavedEntryResult> {
  const draft = await readDraft(db, draftId, userId);
  if (!draft) {
    return { ok: false, reason: 'not_found' };
  }

  if (draft.status !== 'confirmed' || draft.diaryId === null) {
    return { ok: false, reason: 'not_saved' };
  }

  const blocking = findBlockingComponent(draft.components);
  if (blocking) {
    return { ok: false, reason: 'blocked', blockedComponent: blocking.component };
  }

  const diaryId = draft.diaryId;
  const total = calculateTotal(toTotalInputItems(draft.components));

  // D-07/Pitfall 4: localDate is deliberately NOT part of this payload --
  // editing a saved entry must never move it to another day.
  await db
    .update(diary)
    .set({
      kcal: total.kcal,
      proteinG: total.proteinG,
      fatG: total.fatG,
      carbsG: total.carbsG,
      sugarG: total.sugarG,
      description: buildDiaryDescription(draft),
    })
    .where(and(eq(diary.id, diaryId), eq(diary.userId, userId)));

  return { ok: true, diaryId };
}

export type DeleteSavedEntryResult =
  | { ok: true }
  | { ok: false; reason: 'not_confirmed' | 'not_found' | 'not_saved' | 'already_deleted' };

/**
 * D-08: a real, permanent delete — no reversible-flag column, no tombstone
 * row. TECH_SPEC §10 treats this as health data, and D-08 rejected a
 * reversible-flag approach precisely because every future diary query
 * would then have to remember a filter, and forgetting it once makes the
 * totals lie.
 *
 * `confirmed` is a structural reminder, not decoration: the caller (plan
 * 09's handler) must have already collected an explicit second
 * confirmation (`btnDeleteYes`) before calling this with `true`. Requiring
 * it here makes the two-step prompt testable at this layer, not only in the
 * handler.
 *
 * `claimAbandon(..., 'confirmed')` runs BEFORE the DELETE so a repeated tap
 * loses the race and short-circuits into `already_deleted` rather than
 * attempting a second DELETE.
 *
 * The draft row itself is NOT deleted — it becomes `abandoned`, retaining
 * the transcript. This is the known retention debt recorded in
 * `types.ts`'s `DRAFT_TTL_HOURS` comment: there is no purge scheduler in
 * this phase, and these rows hold sensitive text.
 */
export async function deleteSavedEntry(
  db: Db,
  draftId: number,
  userId: number,
  confirmed: boolean,
  // Accepted for interface parity with confirmMeal and plan 09's call
  // sites; unused here for the same reason as recomputeSavedEntry's _now.
  _now: Date = new Date(),
): Promise<DeleteSavedEntryResult> {
  if (!confirmed) {
    return { ok: false, reason: 'not_confirmed' };
  }

  const draft = await readDraft(db, draftId, userId);
  if (!draft) {
    return { ok: false, reason: 'not_found' };
  }

  // Deliberately checks diaryId only, NOT status === 'confirmed': after a
  // first successful delete the draft's status is already 'abandoned' (its
  // diaryId is left in place, see the comment below), and a second call
  // must still reach claimAbandon so it can lose the CAS race and report
  // already_deleted, rather than being turned away one step earlier by a
  // status check that would never let a repeat call observe that outcome.
  if (draft.diaryId === null) {
    return { ok: false, reason: 'not_saved' };
  }

  const diaryId = draft.diaryId;

  const claimed = await claimAbandon(db, draftId, userId, 'confirmed');
  if (!claimed) {
    return { ok: false, reason: 'already_deleted' };
  }

  await db.delete(diary).where(and(eq(diary.id, diaryId), eq(diary.userId, userId)));

  return { ok: true };
}
