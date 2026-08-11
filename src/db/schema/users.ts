/**
 * users — one row per Telegram user, holding the onboarding profile that
 * feeds the target-calorie/macro calculation (ONBOARD-01..04, TECH_SPEC §6).
 *
 * All allowed-literal columns (`sex`, `activity_level`, `goal`) are backed
 * by Postgres `check` constraints in addition to the TypeScript `$type<>()`
 * union — this enforces the domain at the data layer, not only wherever the
 * bot's UI happens to validate input. `desired_rate_kg_per_month` is capped
 * at 0..1 in the database as well, because ONBOARD-02's "never faster than
 * 1 kg/month" rule is a product-safety constraint, not a UI nicety.
 */
import { bigint, check, integer, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    // Telegram user IDs already exceed the 32-bit integer range.
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    sex: text('sex').notNull().$type<'male' | 'female'>(),
    ageYears: integer('age_years').notNull(),
    heightCm: integer('height_cm').notNull(),
    weightKg: real('weight_kg').notNull(),
    activityLevel: text('activity_level')
      .notNull()
      .$type<'minimal' | 'low' | 'medium' | 'high' | 'very_high'>(),
    goal: text('goal').notNull().$type<'gain' | 'loss' | 'maintain'>(),
    // Only meaningful for gain/loss (ONBOARD-02); null for maintain.
    desiredRateKgPerMonth: real('desired_rate_kg_per_month'),
    timezone: text('timezone').notNull().default('Asia/Almaty'),
    // Nullable until onboarding completes and the target calc has run.
    targetKcal: integer('target_kcal'),
    targetProteinG: integer('target_protein_g'),
    targetFatG: integer('target_fat_g'),
    targetCarbsG: integer('target_carbs_g'),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('users_sex_check', sql`${table.sex} in ('male','female')`),
    check(
      'users_activity_level_check',
      sql`${table.activityLevel} in ('minimal','low','medium','high','very_high')`,
    ),
    check('users_goal_check', sql`${table.goal} in ('gain','loss','maintain')`),
    check(
      'users_desired_rate_check',
      sql`${table.desiredRateKgPerMonth} is null or (${table.desiredRateKgPerMonth} >= 0 and ${table.desiredRateKgPerMonth} <= 1)`,
    ),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
