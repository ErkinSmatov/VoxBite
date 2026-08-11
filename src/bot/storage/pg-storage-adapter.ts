/**
 * Postgres implementation of grammY's `StorageAdapter<T>` port (see
 * node_modules/grammy/out/convenience/session.d.ts), backed by the
 * `bot_sessions` table (src/db/schema/bot-sessions.ts, Plan 03).
 *
 * WHY this table/adapter exists: `.planning/research/ARCHITECTURE.md`
 * Anti-Pattern 3 forbids keeping conversation state in process memory — a
 * half-finished onboarding conversation must survive `npm run bot` being
 * restarted. This adapter is passed both to grammY's `session()` middleware
 * and to `@grammyjs/conversations`' `conversations({ storage: { type:
 * 'key', adapter: ... } } })` (both expect the same read/write/delete
 * key->value shape), so both session data and conversation replay state
 * share one durable home.
 *
 * The stored value is entirely opaque to this project — it belongs to
 * grammY/the conversations plugin, not to VoxBite's domain — so this file
 * never interprets, logs, or reshapes it. The column is `jsonb`, so Drizzle
 * serialises/revives the value on the way in/out; no manual
 * `JSON.stringify`/`JSON.parse` layer is added on top.
 *
 * Follows the same factory-function-over-Drizzle-query-builder shape as
 * `src/adapters/fdc-repository.ts`: no raw SQL string interpolation, since
 * `key` is derived from user-controlled chat/user identifiers.
 *
 * KEY NAMESPACING (fix for Phase 2 manual-verification bug, see
 * `.planning/phases/02-bot-skeleton-onboarding/02-07-SUMMARY.md`): grammY's
 * `session()` and `@grammyjs/conversations`' `conversations()` both derive
 * their storage key from `ctx.chatId` by default
 * (`defaultGetSessionKey`/`defaultStorageKey`), so in a private chat they
 * are the *same string*. Two independent adapters built over the same
 * `bot_sessions` table therefore raced on the same row: `session()` wrote
 * its plain `{}` initial value, then `conversations()` read that same row
 * expecting its own versioned envelope and threw `Unknown data format,
 * cannot parse version`. `createPgStorageAdapter` now takes an optional
 * `keyPrefix` so each consumer gets its own namespace within the same
 * table/adapter factory — `bot.ts` passes `'sess:'` for the session
 * adapter and `'conv:'` for the conversations adapter, so the two
 * subsystems never observe each other's writes even though they share a
 * chat ID and a table.
 */
import { eq } from 'drizzle-orm';
import type { StorageAdapter } from 'grammy';
import type { Db } from '../../db/client.js';
import { botSessions } from '../../db/schema/bot-sessions.js';

export function createPgStorageAdapter<T>(db: Db, keyPrefix = ''): StorageAdapter<T> {
  const namespacedKey = (key: string): string => `${keyPrefix}${key}`;

  return {
    async read(key: string): Promise<T | undefined> {
      const rows = await db
        .select({ value: botSessions.value })
        .from(botSessions)
        .where(eq(botSessions.key, namespacedKey(key)));
      return rows[0]?.value as T | undefined;
    },

    async write(key: string, value: T): Promise<void> {
      await db
        .insert(botSessions)
        .values({ key: namespacedKey(key), value: value as object, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: botSessions.key,
          set: { value: value as object, updatedAt: new Date() },
        });
    },

    async delete(key: string): Promise<void> {
      await db.delete(botSessions).where(eq(botSessions.key, namespacedKey(key)));
    },
  };
}
