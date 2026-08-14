/**
 * The voice pipeline's per-user runaway guard (D-15) and onboarding lookup.
 *
 * `isDailyCapReached` protects the shared OpenAI budget from a single
 * looping or confused user, NOT a subscription tariff (tariff limits are a
 * v2 concern -- see PROJECT.md Out of Scope). It uses a rolling 24 hour
 * window rather than a calendar day, deliberately: a calendar day needs the
 * user's timezone, which is a Phase 4/diary concern, and "roughly a day" is
 * precise enough for a runaway guard.
 *
 * The count is wrapped in try/catch and fails OPEN (returns `false`) when it
 * throws: D-15 is a guard against a loop, not a paywall, so a database
 * hiccup in the guard itself must never block a legitimate meal from being
 * logged. Everything that actually costs money is still gated by
 * `claimUpdate` (src/application/idempotency.ts) and by the pipeline's
 * 60-second voice-duration cap.
 *
 * `findOnboardedUser` exists because `diary_drafts.user_id` is a foreign key
 * to `users.id` (plan 03-02): a user who is on the beta allowlist but has
 * never finished `/start` has no row for a draft to reference. Detecting
 * that up front, before any paid call, turns a late foreign-key crash into
 * an immediate, actionable Russian reply (`pipelineCopy.notOnboarded`).
 *
 * Nothing in this module may import `grammy`, and nothing may hold
 * module-level state (src/application/types.ts's two hard rules).
 */
import { and, count, eq, gte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { processedUpdates } from '../db/schema/processed-updates.js';
import { users } from '../db/schema/users.js';
import { DAILY_MESSAGE_CAP } from './types.js';

/**
 * Counts `processedUpdates` rows for `telegramId` whose `createdAt` falls
 * within the trailing `windowHours` (default 24), matching the
 * `(telegram_id, created_at)` index shape from plan 03-02. Computes the
 * cutoff timestamp in JavaScript (not SQL date arithmetic) so the query is a
 * plain indexed `WHERE telegram_id = ? AND created_at >= ?`.
 */
export async function countRecentUpdates(db: Db, telegramId: number, windowHours = 24): Promise<number> {
  const since = new Date(Date.now() - windowHours * 3600_000);

  const rows = await db
    .select({ value: count() })
    .from(processedUpdates)
    .where(and(eq(processedUpdates.telegramId, telegramId), gte(processedUpdates.createdAt, since)));

  return Number(rows[0]?.value ?? 0);
}

/**
 * `true` once `telegramId` has exceeded `DAILY_MESSAGE_CAP` messages in the
 * trailing 24 hours.
 *
 * ORDERING INVARIANT (CR-02 follow-up): every caller runs `claimUpdate()`
 * FIRST, so the message being judged right now is ALREADY one of the rows
 * this count returns. On the Nth message of the window the count is N, which
 * is why the comparison is `>` and not `>=`. With `>=` the user was cut off
 * after DAILY_MESSAGE_CAP - 1 processed messages -- an effective cap of 29
 * against a declared 30. Do not "fix" this to `>=` without also moving the
 * claim after the count.
 *
 * Fails open (`false`) if the count query itself throws -- see module doc
 * comment. The catch logs one fixed Russian operator line naming only the
 * failure kind, never the telegram id or any message content, matching
 * `src/bot/error-handler.ts`'s logging invariant.
 */
export async function isDailyCapReached(db: Db, telegramId: number): Promise<boolean> {
  let recentCount: number;
  try {
    recentCount = await countRecentUpdates(db, telegramId);
  } catch {
    console.error('Не удалось проверить дневной лимит сообщений (ошибка запроса к базе) -- открываем лимит');
    return false;
  }

  return recentCount > DAILY_MESSAGE_CAP;
}

/**
 * Looks up `users.id` by `telegramId`, requiring `onboardedAt` to be set --
 * copies the query shape of `src/bot/commands/start.ts` rather than
 * inventing a second one. Returns `null` both when no row exists and when
 * the row exists but onboarding was never completed.
 */
export async function findOnboardedUser(db: Db, telegramId: number): Promise<{ id: number } | null> {
  const rows = await db
    .select({ id: users.id, onboardedAt: users.onboardedAt })
    .from(users)
    .where(eq(users.telegramId, telegramId))
    .limit(1);

  const user = rows[0];
  if (user === undefined || user.onboardedAt === null) {
    return null;
  }

  return { id: user.id };
}
