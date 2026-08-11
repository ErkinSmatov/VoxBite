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
 */
import { eq } from 'drizzle-orm';
import type { StorageAdapter } from 'grammy';
import type { Db } from '../../db/client.js';
import { botSessions } from '../../db/schema/bot-sessions.js';

export function createPgStorageAdapter<T>(db: Db): StorageAdapter<T> {
  return {
    async read(key: string): Promise<T | undefined> {
      const rows = await db
        .select({ value: botSessions.value })
        .from(botSessions)
        .where(eq(botSessions.key, key));
      return rows[0]?.value as T | undefined;
    },

    async write(key: string, value: T): Promise<void> {
      await db
        .insert(botSessions)
        .values({ key, value: value as object, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: botSessions.key,
          set: { value: value as object, updatedAt: new Date() },
        });
    },

    async delete(key: string): Promise<void> {
      await db.delete(botSessions).where(eq(botSessions.key, key));
    },
  };
}
