/**
 * diary — STUB table for Phase 1.
 *
 * Phase 4 (the CORRECT, CALC and DIARY-01 requirements) extends this table
 * with per-component rows (the individual ingredients that made up a logged
 * meal) and persisted draft state (the in-progress "confirm your
 * ingredients" flow). This phase only needs the table to exist so the
 * migration set is complete and downstream plans can reference `diary`
 * without a schema change.
 */
import { date, index, integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

export const diary = pgTable(
  'diary',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eatenAt: timestamp('eaten_at', { withTimezone: true }).defaultNow().notNull(),
    // The user's own calendar day (per their timezone) — DIARY-01 needs day
    // bucketing that survives timezone math, so this is stored explicitly
    // rather than derived from `eaten_at` at query time.
    localDate: date('local_date').notNull(),
    description: text('description').notNull(),
    kcal: real('kcal'),
    proteinG: real('protein_g'),
    fatG: real('fat_g'),
    carbsG: real('carbs_g'),
    sugarG: real('sugar_g'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('diary_user_date_idx').on(table.userId, table.localDate)],
);

export type DiaryRow = typeof diary.$inferSelect;
export type NewDiaryRow = typeof diary.$inferInsert;
