/**
 * draft-store — the D-19 write: persists the "confirm your ingredients"
 * draft into `diary_drafts` (schema: plan 03-02) once a meal has been fully
 * decomposed and matched. Extended in plan 04-04 into the full read/mutate
 * store the correction flow (plans 07-10) runs on.
 *
 * WHY this write happens in Phase 3, not deferred to Phase 4: per
 * ARCHITECTURE.md Anti-Pattern 4, orchestration-layer state must never live
 * in process memory — a draft awaiting user confirmation must survive a bot
 * restart between "voice message processed" and "user taps confirm" (which
 * may be minutes or hours later). Persisting it here means Phase 4 extends
 * this table instead of rewriting Phase 3's ending.
 *
 * `row.components` is written as a `jsonb` array of `DraftComponent` — see
 * `src/db/schema/diary-drafts.ts` for the exact shape and why it stays
 * unnormalised.
 *
 * Takes `db` as a parameter (never imports a client itself), in the style of
 * `src/bot/storage/pg-storage-adapter.ts`.
 *
 * Two hard rules restated from `src/application/types.ts` (this file is
 * `src/application/`, so both apply): never import `grammy`, and never hold
 * module-level state — every function below takes `db` and reads/writes
 * Postgres, nothing is cached here.
 *
 * IDOR RULE (04-RESEARCH.md Security Domain V4): a `draftId` arriving from
 * Telegram `callback_data` is user-controlled input, never authorization.
 * Every read and every write in this file filters on BOTH
 * `and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId))`. There
 * is deliberately no unscoped overload — do not add one "for convenience";
 * a later caller will use it and reintroduce the IDOR hole this file exists
 * to close.
 *
 * ACCEPTED TRADEOFF (this plan's objective, CLAUDE.md-transparent): only
 * `claimConfirm` and `claimAbandon` are protected by compare-and-swap
 * (conditional `UPDATE ... WHERE status = <expected> RETURNING id`). The
 * `±10 г` gram-adjustment path has no CAS — a double tap can apply once
 * instead of twice, which is a visible, self-correcting nuisance (the user
 * taps again), whereas a double-applied confirm would silently create a
 * second diary row the user cannot see or reconcile. Revisit with a
 * `version` column on `diary_drafts` only if beta users report grams "not
 * registering" — do not add row locking pre-emptively.
 *
 * LOGGING RULE: nothing in this file logs transcript or component text. If a
 * helper logs at all, it logs only the draft id and the operation name (the
 * `voice-pipeline.ts` logging invariant).
 */
import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { diaryDrafts, type DraftAwaitingInput, type NewDiaryDraft } from '../db/schema/diary-drafts.js';
import type { DraftComponent, PersistedDraft } from './types.js';

/** Inserts one diary_drafts row and returns its generated id. */
export async function saveDraft(db: Db, row: NewDiaryDraft): Promise<number> {
  const rows = await db.insert(diaryDrafts).values(row).returning({ id: diaryDrafts.id });
  const inserted = rows[0];
  if (!inserted) {
    throw new Error('saveDraft: insert returned no row');
  }
  return inserted.id;
}

/** Every column `PersistedDraft` needs, selected once and shared below. */
const draftColumns = {
  id: diaryDrafts.id,
  userId: diaryDrafts.userId,
  chatId: diaryDrafts.chatId,
  messageId: diaryDrafts.messageId,
  source: diaryDrafts.source,
  transcript: diaryDrafts.transcript,
  components: diaryDrafts.components,
  status: diaryDrafts.status,
  awaitingInput: diaryDrafts.awaitingInput,
  localDate: diaryDrafts.localDate,
  diaryId: diaryDrafts.diaryId,
  createdAt: diaryDrafts.createdAt,
};

/**
 * Narrows a raw select row to `PersistedDraft`: `components` is the jsonb
 * column cast to `DraftComponent[]` (Drizzle types `jsonb` columns without
 * an explicit `.$type<>()` as `unknown` at the query-result level).
 */
function toPersistedDraft(row: Record<string, unknown>): PersistedDraft {
  return row as unknown as PersistedDraft;
}

/**
 * Scoped read of one draft. Returns `null` when the row is absent OR
 * belongs to a different user — never throws for a miss, and never reveals
 * (via a different error shape) whether the row exists for someone else.
 */
export async function readDraft(db: Db, draftId: number, userId: number): Promise<PersistedDraft | null> {
  const rows = await db
    .select(draftColumns)
    .from(diaryDrafts)
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return toPersistedDraft(row);
}

/**
 * The most recent `status = 'draft'` row for this user that is currently
 * waiting on a free-text reply (`awaiting_input IS NOT NULL`). This is what
 * plan 10's text gate calls to decide whether an incoming plain-text message
 * is correction input or a new (paid) meal message (D-04).
 */
export async function findAwaitingDraft(db: Db, userId: number): Promise<PersistedDraft | null> {
  const rows = await db
    .select(draftColumns)
    .from(diaryDrafts)
    .where(
      and(eq(diaryDrafts.userId, userId), eq(diaryDrafts.status, 'draft'), isNotNull(diaryDrafts.awaitingInput)),
    )
    .orderBy(desc(diaryDrafts.updatedAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }
  return toPersistedDraft(row);
}

/**
 * Scoped UPDATE of `components` (+ `updatedAt`). Also requires the row to be
 * `status = 'draft'` OR `status = 'confirmed'` — editing a saved entry
 * (D-05/CORRECT-08) mutates a confirmed draft in place, but an abandoned one
 * must never be resurrected by a stray write. Returns whether a row was
 * affected.
 */
export async function updateDraftComponents(
  db: Db,
  draftId: number,
  userId: number,
  components: DraftComponent[],
): Promise<boolean> {
  const rows = await db
    .update(diaryDrafts)
    .set({ components, updatedAt: new Date() })
    .where(
      and(
        eq(diaryDrafts.id, draftId),
        eq(diaryDrafts.userId, userId),
        or(eq(diaryDrafts.status, 'draft'), eq(diaryDrafts.status, 'confirmed')),
      ),
    )
    .returning({ id: diaryDrafts.id });

  return rows.length > 0;
}

/** Scoped UPDATE of `awaiting_input` (+ `updatedAt`) to the given value. */
export async function setAwaitingInput(
  db: Db,
  draftId: number,
  userId: number,
  awaiting: DraftAwaitingInput,
): Promise<boolean> {
  const rows = await db
    .update(diaryDrafts)
    .set({ awaitingInput: awaiting, updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId)))
    .returning({ id: diaryDrafts.id });

  return rows.length > 0;
}

/** Scoped UPDATE that nulls out `awaiting_input` (+ `updatedAt`). */
export async function clearAwaitingInput(db: Db, draftId: number, userId: number): Promise<boolean> {
  const rows = await db
    .update(diaryDrafts)
    .set({ awaitingInput: null, updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId)))
    .returning({ id: diaryDrafts.id });

  return rows.length > 0;
}

/**
 * Scoped UPDATE of `status` (+ `updatedAt`). One parameterised function,
 * mirroring `idempotency.ts`'s `markUpdateStatus` — no markConfirmed/
 * markAbandoned variants.
 */
export async function markDraftStatus(
  db: Db,
  draftId: number,
  userId: number,
  status: 'draft' | 'confirmed' | 'abandoned',
): Promise<void> {
  await db
    .update(diaryDrafts)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId)));
}

/**
 * The compare-and-swap confirm claim (Pitfall 3): only succeeds when the row
 * is currently `status = 'draft'`. `true` means this call won the race;
 * `false` means a concurrent tap already confirmed it — the caller treats
 * that as a no-op, never an error, since a second diary row must never be
 * created for the same draft.
 */
export async function claimConfirm(db: Db, draftId: number, userId: number): Promise<boolean> {
  const rows = await db
    .update(diaryDrafts)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId), eq(diaryDrafts.status, 'draft')))
    .returning({ id: diaryDrafts.id });

  return rows.length > 0;
}

/**
 * The same conditional-claim shape as `claimConfirm`, used both by
 * `✕ Отменить разбор` (`fromStatus: 'draft'`, D-12) and by the
 * confirmed-entry delete flow (`fromStatus: 'confirmed'`, D-08). `true` only
 * when the row was in exactly the expected status.
 */
export async function claimAbandon(
  db: Db,
  draftId: number,
  userId: number,
  fromStatus: 'draft' | 'confirmed',
): Promise<boolean> {
  const rows = await db
    .update(diaryDrafts)
    .set({ status: 'abandoned', updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId), eq(diaryDrafts.status, fromStatus)))
    .returning({ id: diaryDrafts.id });

  return rows.length > 0;
}

/**
 * Sets `diary_id` after the diary insert (D-06's back-reference from a draft
 * to the confirmed diary row it produced).
 */
export async function linkDiaryRow(db: Db, draftId: number, userId: number, diaryId: number): Promise<void> {
  await db
    .update(diaryDrafts)
    .set({ diaryId, updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.userId, userId)));
}
