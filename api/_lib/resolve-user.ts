/**
 * resolve-user — turns a validated `initData`'s `user.id` into an onboarded
 * `users` row, the web equivalent of the bot's `findOnboardedUser` call
 * before any paid pipeline step. Calls `findOnboardedUser` directly (does
 * NOT write a second `users` query) — same DRY and IDOR-adjacent rule
 * `04.1-PATTERNS.md` calls out for this file.
 *
 * `telegramId` is `undefined` when a validated `initData` string carries no
 * `user` object at all (Telegram omits it in some contexts) — that is not
 * an identity, so this resolves to `null` without touching the database.
 */
import { findOnboardedUser } from '../../src/application/limits';
import type { Db } from '../../src/db/client';

export async function resolveUser(
  db: Db,
  telegramId: number | undefined,
): Promise<{ id: number; timezone: string } | null> {
  if (telegramId === undefined) {
    return null;
  }
  return findOnboardedUser(db, telegramId);
}
