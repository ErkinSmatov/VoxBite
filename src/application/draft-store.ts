/**
 * draft-store — the D-19 write: persists the "confirm your ingredients"
 * draft into `diary_drafts` (schema: plan 03-02) once a meal has been fully
 * decomposed and matched.
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
 */
import type { Db } from '../db/client.js';
import { diaryDrafts, type NewDiaryDraft } from '../db/schema/diary-drafts.js';

/** Inserts one diary_drafts row and returns its generated id. */
export async function saveDraft(db: Db, row: NewDiaryDraft): Promise<number> {
  const rows = await db.insert(diaryDrafts).values(row).returning({ id: diaryDrafts.id });
  const inserted = rows[0];
  if (!inserted) {
    throw new Error('saveDraft: insert returned no row');
  }
  return inserted.id;
}
