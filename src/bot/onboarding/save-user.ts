/**
 * save-user — idempotent persistence of a completed onboarding profile plus
 * its calculated targets (ONBOARD-05).
 *
 * Why this is an upsert, not a plain insert: `@grammyjs/conversations`
 * replays the conversation function's body after every incoming update
 * (RESEARCH.md Pitfall 2), so a naive `insert()` executed inside the
 * conversation could run more than once for the same user and crash on the
 * `users.telegram_id` unique constraint, or worse, leave a partial write.
 * `conversation.external()` around the call site (src/bot/conversations/onboarding.ts)
 * is the first line of defence — this upsert is the second, so a duplicate
 * execution converges on one correct row instead of erroring or duplicating.
 *
 * Persists `targets.rateKgPerMonth` (the value the domain actually used
 * after clamping to MAX_RATE_KG_PER_MONTH), never `answers.desiredRateKgPerMonth`
 * (the user's raw, possibly-too-fast request) — what is stored must be what
 * was actually calculated against.
 *
 * Drizzle builder only, no raw SQL. Zero grammY imports (this file lives
 * under src/bot/onboarding/, per D-08). No `console.*` output anywhere in
 * this file: sex, age and weight are personal, health-adjacent data.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema/users.js';
import type { NutritionTargets } from '../../domain/nutrition/index.js';
import type { OnboardingAnswers } from './assemble-profile.js';

export interface SaveOnboardedUserInput {
  telegramId: number;
  answers: OnboardingAnswers;
  targets: NutritionTargets;
}

function assertValidTelegramId(telegramId: number): void {
  if (
    !Number.isSafeInteger(telegramId) ||
    telegramId <= 0
  ) {
    throw new Error('saveOnboardedUser: telegramId must be a positive safe integer');
  }
}

export async function saveOnboardedUser(db: Db, input: SaveOnboardedUserInput): Promise<void> {
  assertValidTelegramId(input.telegramId);

  const { telegramId, answers, targets } = input;
  const now = new Date();

  const values = {
    telegramId,
    sex: answers.sex,
    ageYears: answers.ageYears,
    heightCm: answers.heightCm,
    weightKg: answers.weightKg,
    activityLevel: answers.activityLevel,
    goal: answers.goal,
    desiredRateKgPerMonth: answers.goal === 'maintain' ? null : targets.rateKgPerMonth,
    timezone: answers.timezone,
    targetKcal: Math.round(targets.targetKcal),
    targetProteinG: Math.round(targets.proteinG),
    targetFatG: Math.round(targets.fatG),
    targetCarbsG: Math.round(targets.carbsG),
    onboardedAt: now,
    updatedAt: now,
  };

  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        sex: sql`excluded.sex`,
        ageYears: sql`excluded.age_years`,
        heightCm: sql`excluded.height_cm`,
        weightKg: sql`excluded.weight_kg`,
        activityLevel: sql`excluded.activity_level`,
        goal: sql`excluded.goal`,
        desiredRateKgPerMonth: sql`excluded.desired_rate_kg_per_month`,
        timezone: sql`excluded.timezone`,
        targetKcal: sql`excluded.target_kcal`,
        targetProteinG: sql`excluded.target_protein_g`,
        targetFatG: sql`excluded.target_fat_g`,
        targetCarbsG: sql`excluded.target_carbs_g`,
        onboardedAt: sql`excluded.onboarded_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}
