/**
 * bot_sessions — key/value store backing grammY's session storage and the
 * `@grammyjs/conversations` plugin (multi-step onboarding flow).
 *
 * WHY this table exists: `.planning/research/ARCHITECTURE.md` Anti-Pattern 3
 * forbids keeping conversation state in process memory — a half-finished
 * onboarding must survive `npm run bot` being restarted. grammY's session
 * middleware and the conversations plugin both need a durable storage
 * adapter to persist that state between messages/restarts, and this table
 * is that storage.
 *
 * `key` is the grammY session key (grammY decides its shape — usually
 * derived from chat/user id); `value` is the plugin's own serialized blob.
 * This project never interprets `value`'s contents — it is opaque storage,
 * not application data — so there is no point modelling individual fields.
 * `jsonb` (not `text`) is used so Postgres itself validates that the stored
 * blob is well-formed JSON.
 *
 * Like `users`, `diary` and `fdc_foods` in Phase 1, this table gets
 * `ENABLE ROW LEVEL SECURITY` with zero policies (see
 * `drizzle/0004_bot_sessions_rls.sql`) — Supabase publishes every `public`
 * table through its PostgREST API to anyone holding the public anon key,
 * and `bot_sessions` can hold partially-completed onboarding answers
 * (sex, age, weight), which is exactly as sensitive as `users`.
 */
import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const botSessions = pgTable('bot_sessions', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type BotSessionRow = typeof botSessions.$inferSelect;
export type NewBotSessionRow = typeof botSessions.$inferInsert;
