/**
 * The voice pipeline's spend-control gate (D-10/D-11) and crash-recovery
 * ledger, over `processed_updates` (schema: plan 03-02).
 *
 * ORDERING RULE (this is the module's entire reason to exist): `claimUpdate`
 * MUST be called and awaited BEFORE the audio download and before every paid
 * API call (STT, decomposition, embeddings). Telegram redelivers the same
 * `update_id` on network hiccups and on bot restart mid-handler -- without a
 * durable claim written first, a redelivery would trigger a second (paid)
 * transcription/decomposition of the exact same voice message. `claimUpdate`
 * inserts a row keyed on `update_id` with `onConflictDoNothing`, so a
 * redelivery loses the race at the database level: the insert returns zero
 * rows, `claimUpdate` returns `false`, and the caller stops silently instead
 * of spending money twice.
 *
 * WHY NOT an in-memory `Set<number>` of seen update_ids (D-10): a `Set` dies
 * with the process -- exactly in the crash-restart case this guard exists to
 * protect against. A Postgres row survives a restart; a `Set` does not.
 *
 * `status` makes a crash mid-pipeline detectable (D-11): a row still in
 * `'processing'` when the process starts means a previous run died partway
 * through. `findInterruptedUpdates` is that startup sweep's query -- the
 * caller is expected to notify the affected user and then call
 * `markInterrupted`. There is deliberately no resume path anywhere in this
 * module: the source audio is gone by design (D-05), so a half-resume is not
 * worth the complexity in a closed beta.
 *
 * Nothing in this module may import `grammy`, and nothing may hold
 * module-level state (src/application/types.ts's two hard rules).
 */
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { processedUpdates, type ProcessedUpdateStatus } from '../db/schema/processed-updates.js';

export interface ClaimUpdateArgs {
  db: Db;
  updateId: number;
  telegramId: number;
  chatId: number;
  kind: 'voice' | 'text';
}

/**
 * Inserts a `processed_updates` row for `updateId` with status
 * `'processing'`. Returns `true` when this call won the race (proceed with
 * the pipeline), `false` when the row already existed (stop immediately --
 * a duplicate delivery, already handled or in flight).
 */
export async function claimUpdate(args: ClaimUpdateArgs): Promise<boolean> {
  const { db, updateId, telegramId, chatId, kind } = args;

  const rows = await db
    .insert(processedUpdates)
    .values({ updateId, telegramId, chatId, kind, status: 'processing' })
    .onConflictDoNothing({ target: processedUpdates.updateId })
    .returning({ updateId: processedUpdates.updateId });

  return rows.length > 0;
}

/**
 * Updates `status` (and refreshes `updatedAt`) for the row matching
 * `updateId`. Takes the status as a parameter rather than four near-identical
 * `markDone`/`markFailed`/... functions.
 */
export async function markUpdateStatus(db: Db, updateId: number, status: ProcessedUpdateStatus): Promise<void> {
  await db
    .update(processedUpdates)
    .set({ status, updatedAt: new Date() })
    .where(eq(processedUpdates.updateId, updateId));
}

/**
 * The D-11 startup sweep's query: rows still in `'processing'` are updates
 * whose pipeline died mid-run in a previous process. The caller notifies the
 * affected chat and then calls `markInterrupted` -- this function itself
 * never re-enqueues or resumes anything.
 */
export async function findInterruptedUpdates(
  db: Db,
): Promise<{ updateId: number; chatId: number; telegramId: number }[]> {
  return db
    .select({
      updateId: processedUpdates.updateId,
      chatId: processedUpdates.chatId,
      telegramId: processedUpdates.telegramId,
    })
    .from(processedUpdates)
    .where(eq(processedUpdates.status, 'processing'));
}

/**
 * Moves the given update ids to the terminal `'interrupted'` status. Issues
 * no query at all for an empty array -- `inArray` with an empty list is a
 * SQL footgun (some drivers turn it into `IN ()`, which is invalid syntax or
 * an unconditionally-false predicate depending on the driver).
 */
export async function markInterrupted(db: Db, updateIds: number[]): Promise<void> {
  if (updateIds.length === 0) {
    return;
  }

  await db
    .update(processedUpdates)
    .set({ status: 'interrupted', updatedAt: new Date() })
    .where(inArray(processedUpdates.updateId, updateIds));
}
