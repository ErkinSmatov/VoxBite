/**
 * diary_drafts — the persisted "confirm your ingredients" draft (D-19).
 *
 * WHY this table exists: between "voice message transcribed and decomposed"
 * and "user confirms the ingredient list", the draft must survive a bot
 * restart — the same in-process-memory ban that motivated `bot_sessions`
 * (see `.planning/research/ARCHITECTURE.md` Anti-Pattern 3) applies here.
 * `update_id` links a draft back to the `processed_updates` ledger row that
 * authorised it (a unique constraint on `update_id` means a duplicated
 * Telegram delivery can never produce two drafts for the same message).
 * `message_id` is the ack message the bot edits in place as processing
 * progresses (D-13) and the anchor Phase 4's inline keyboard attaches to.
 *
 * `transcript` is persisted (the raw audio is not, per D-05) because it is
 * the only way to tell, after the fact, whether a bad result came from an
 * STT error or an LLM decomposition error.
 *
 * `components` is stored as `jsonb`, not normalised into separate rows: it
 * holds the array of `{ component, componentEn, grams, candidates,
 * chosenFdcId, weakMatch }` that Phase 4 owns and will evolve — normalising
 * the shape now would force Phase 4 to migrate a structure it has not
 * designed yet, before it has even used it once.
 *
 * Like `users`, `diary`, `fdc_foods`, `bot_sessions` and `processed_updates`,
 * this table gets `ENABLE ROW LEVEL SECURITY` with zero policies (see
 * `drizzle/0006_voice_pipeline_rls.sql`) — Supabase publishes every `public`
 * table through its PostgREST API to anyone holding the project's public
 * anon key, and `diary_drafts` holds what people ate, which is health data.
 */
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { diary } from './diary';

/**
 * D-04: the shape of `diary_drafts.awaiting_input`. Set when the user has
 * tapped a button that expects a free-text reply next (`➕ Добавить` or
 * `⌨ Ввести граммы`), so the plain-text handler in `src/bot/handlers/meal.ts`
 * can route the next message into the correction flow instead of spending on
 * a new (paid) voice/text meal analysis. `componentIndex` is only meaningful
 * for `typed_grams` (which existing component the typed number applies to);
 * `add_component` has none because it always appends.
 */
export interface DraftAwaitingInput {
  kind: 'add_component' | 'typed_grams';
  componentIndex?: number;
}

export const diaryDrafts = pgTable(
  'diary_drafts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Links back to the processed_updates ledger row that authorised this
    // draft; unique so a duplicated update can never produce two drafts.
    updateId: bigint('update_id', { mode: 'number' }).notNull(),
    chatId: bigint('chat_id', { mode: 'number' }).notNull(),
    // The ack message the bot edits in place (D-13) and the anchor Phase 4
    // hangs its inline keyboard on.
    messageId: bigint('message_id', { mode: 'number' }).notNull(),
    source: text('source').notNull().$type<'voice' | 'text'>(),
    // Persisted per D-05 — the audio itself is not kept; the transcript is
    // the only way to tell an STT error from an LLM error after the fact.
    transcript: text('transcript').notNull(),
    // Array of { component, componentEn, grams, candidates, chosenFdcId,
    // weakMatch } — jsonb, not normalised rows, so Phase 4 owns further
    // schema evolution of this shape without a migration here.
    components: jsonb('components').notNull(),
    status: text('status').notNull().default('draft').$type<'draft' | 'confirmed' | 'abandoned'>(),
    // D-04: what free-text reply the bot is waiting for, and for which
    // component. Lives in Postgres, not process memory — the same rule as
    // everything else in `src/application/` (ARCHITECTURE.md Anti-Pattern 4)
    // — so a mid-typing bot restart does not silently drop the user into the
    // paid pipeline on their next message. Cleared (`null`) once the reply
    // is consumed, cancelled, or the draft times out (D-11).
    awaitingInput: jsonb('awaiting_input').$type<DraftAwaitingInput | null>(),
    // D-07: the calendar day this meal belongs to, in the user's own
    // timezone, frozen at the moment the original voice/text message
    // arrived — never recomputed later, including on confirm or edit.
    // NULLABLE only because rows created by Phase 3 (before this migration)
    // have no honest day to backfill; a NOT NULL column would force
    // inventing one. Phase 4's write path always sets this. A row with
    // `local_date IS NULL` is a pre-Phase-4 leftover, and plan 08's
    // `confirm()` refuses it with the same copy a stale (D-11) draft gets —
    // do not invent a backfill value here or anywhere downstream.
    localDate: date('local_date'),
    // D-06: set only when this draft is confirmed — points at the `diary`
    // row that snapshots its totals. A confirmed draft is a durable record
    // (the working copy of a real diary entry), not disposable state: no
    // cleanup job may ever delete a `status = 'confirmed'` row.
    diaryId: integer('diary_id').references((): AnyPgColumn => diary.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      'diary_drafts_status_check',
      sql`${table.status} in ('draft','confirmed','abandoned')`,
    ),
    check('diary_drafts_source_check', sql`${table.source} in ('voice','text')`),
    unique('diary_drafts_update_id_key').on(table.updateId),
    index('diary_drafts_user_idx').on(table.userId, table.createdAt),
  ],
);

export type DiaryDraftRow = typeof diaryDrafts.$inferSelect;
export type NewDiaryDraft = typeof diaryDrafts.$inferInsert;
