/**
 * diary — a saved, confirmed meal entry.
 *
 * D-06: `diary_drafts` stays the working copy of a meal's composition (the
 * component list, candidate FDC matches, corrections in progress); this
 * table holds a snapshot of the computed totals for a *confirmed* meal, plus
 * `draft_id` pointing back at the draft it came from. Phase 4 deliberately
 * does NOT normalise the individual ingredients into their own rows here — a
 * separate `diary_items` table
 * was rejected (D-06) as two containers for the same data (draft components
 * + diary items) meaning two code paths for the same bug, and as a layer
 * serving an analytics feature (`v2` "what do you eat most often") that does
 * not exist in v1. `draft_id` is how `✎ Поправить` on a saved entry finds
 * its way back into the same correction machinery that built it.
 *
 * `sugarG` (and every other nutrient column) stays nullable — CALC-02 /
 * TECH_SPEC §5.8: a missing USDA measurement is recorded as `null`, never a
 * guessed or defaulted `0`.
 */
import {
  type AnyPgColumn,
  date,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { diaryDrafts } from './diary-drafts.js';

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
    // D-06: the draft this entry's totals were computed from. The draft is
    // the working copy of the meal composition; this row is the snapshot of
    // its totals. Every confirmed entry has exactly one draft — `notNull`
    // because `diary` only ever gets a row via confirmation (D-05/D-06),
    // never independently. Typed as `(): AnyPgColumn => diaryDrafts.id`
    // (drizzle's documented pattern for a two-table reference cycle —
    // `diary-drafts.ts` references `diary.id` for D-06's `diary_id`
    // back-link) so TypeScript does not try to infer both tables'
    // column types from each other at once; drizzle-kit still generates
    // the normal FK constraint either way.
    draftId: integer('draft_id')
      .notNull()
      .references((): AnyPgColumn => diaryDrafts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('diary_user_date_idx').on(table.userId, table.localDate)],
);

export type DiaryRow = typeof diary.$inferSelect;
export type NewDiaryRow = typeof diary.$inferInsert;
