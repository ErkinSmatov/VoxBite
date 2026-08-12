/**
 * processed_updates — the idempotency ledger for the voice pipeline (D-10,
 * D-11).
 *
 * WHY this table exists: Telegram can and does redeliver the same update
 * (network retry, bot restart during a long-running handler) — without a
 * durable, database-enforced record of "I already handled this", a retried
 * voice message could trigger a second (paid) STT/LLM call for the exact
 * same input, or worse, create a duplicate diary entry. A row is inserted
 * into this table BEFORE any paid API call is made, keyed on Telegram's own
 * `update_id`, so a retried delivery hits a primary-key conflict and is
 * rejected by Postgres itself — this guarantee lives in the database, not in
 * application code that a future handler could accidentally bypass (D-10).
 *
 * `status` exists so a crash mid-pipeline is detectable at next startup
 * (D-11): a row left in `processing` after a restart means the pipeline died
 * partway through, and the startup sweep can use `telegram_id`/`chat_id` to
 * notify the affected user instead of leaving them wondering what happened
 * to their voice message. `processed_updates_user_day_idx` on
 * `(telegram_id, created_at)` exists because the per-user daily voice-message
 * cap (D-15) counts rows in this table — without the index that count
 * degrades into a full sequential scan as the ledger grows.
 *
 * Like `users`, `diary`, `fdc_foods` and `bot_sessions` before it, this table
 * gets `ENABLE ROW LEVEL SECURITY` with zero policies (see
 * `drizzle/0006_voice_pipeline_rls.sql`) — Supabase publishes every `public`
 * table through its PostgREST API to anyone holding the project's public
 * anon key, and this table holds Telegram user/chat ids.
 */
import { bigint, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const processedUpdates = pgTable(
  'processed_updates',
  {
    // Telegram's own update_id is the natural key: making it the primary
    // key means a duplicate delivery is rejected by the database itself.
    updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    kind: text('kind').notNull().$type<'voice' | 'text'>(),
    status: text('status').notNull().$type<'processing' | 'done' | 'interrupted' | 'failed'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'processed_updates_status_check',
      sql`${table.status} in ('processing','done','interrupted','failed')`,
    ),
    check('processed_updates_kind_check', sql`${table.kind} in ('voice','text')`),
    index('processed_updates_user_day_idx').on(table.telegramId, table.createdAt),
  ],
);

export type ProcessedUpdateRow = typeof processedUpdates.$inferSelect;
export type NewProcessedUpdate = typeof processedUpdates.$inferInsert;
export type ProcessedUpdateStatus = 'processing' | 'done' | 'interrupted' | 'failed';
