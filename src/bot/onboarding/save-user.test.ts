import { describe, expect, it, vi } from 'vitest';
import type { NutritionTargets } from '../../domain/nutrition/index.js';
import type { OnboardingAnswers } from './assemble-profile.js';
import { saveOnboardedUser } from './save-user.js';

/**
 * Hand-written fake `db` — records the exact `.insert().values().onConflictDoUpdate()`
 * call it received, exactly like `pg-storage-adapter.test.ts`'s `makeFakeDb()`.
 * Opens no real database connection.
 */
function makeFakeDb() {
  const calls: Array<{ values: unknown; onConflictDoUpdate: unknown }> = [];
  const insertCalls: unknown[] = [];

  const db = {
    insert(table: unknown) {
      insertCalls.push(table);
      return {
        values(values: unknown) {
          return {
            onConflictDoUpdate(config: unknown) {
              calls.push({ values, onConflictDoUpdate: config });
              return Promise.resolve();
            },
          };
        },
      };
    },
  };

  return { db, calls, insertCalls };
}

const baseAnswers: OnboardingAnswers = {
  sex: 'male',
  ageYears: 29,
  heightCm: 178,
  weightKg: 72.5,
  activityLevel: 'medium',
  goal: 'loss',
  desiredRateKgPerMonth: 0.5,
  timezone: 'Asia/Almaty',
};

const baseTargets: NutritionTargets = {
  bmr: 1700.4,
  tdee: 2635.62,
  targetKcal: 2378.62,
  proteinG: 130.5,
  fatG: 65.3,
  carbsG: 250.7,
  floorApplied: false,
  rateKgPerMonth: 0.5,
};

describe('saveOnboardedUser', () => {
  it('issues exactly one insert statement using onConflictDoUpdate targeting telegramId', async () => {
    const { db, calls, insertCalls } = makeFakeDb();
    await saveOnboardedUser(db as never, {
      telegramId: 123456789,
      answers: baseAnswers,
      targets: baseTargets,
    });

    expect(insertCalls).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const config = calls[0]!.onConflictDoUpdate as { target: unknown };
    expect(config.target).toBeDefined();
  });

  it('writes every required column', async () => {
    const { db, calls } = makeFakeDb();
    await saveOnboardedUser(db as never, {
      telegramId: 123456789,
      answers: baseAnswers,
      targets: baseTargets,
    });

    const values = calls[0]!.values as Record<string, unknown>;
    expect(values.telegramId).toBe(123456789);
    expect(values.sex).toBe('male');
    expect(values.ageYears).toBe(29);
    expect(values.heightCm).toBe(178);
    expect(values.weightKg).toBe(72.5);
    expect(values.activityLevel).toBe('medium');
    expect(values.goal).toBe('loss');
    expect(values.timezone).toBe('Asia/Almaty');
    expect(values.onboardedAt).toBeInstanceOf(Date);
    expect(values.updatedAt).toBeInstanceOf(Date);
  });

  it('desiredRateKgPerMonth is null for goal: maintain', async () => {
    const { db, calls } = makeFakeDb();
    await saveOnboardedUser(db as never, {
      telegramId: 123456789,
      answers: { ...baseAnswers, goal: 'maintain', desiredRateKgPerMonth: undefined },
      targets: { ...baseTargets, rateKgPerMonth: 0 },
    });

    const values = calls[0]!.values as Record<string, unknown>;
    expect(values.desiredRateKgPerMonth).toBeNull();
  });

  it('persisted rate equals targets.rateKgPerMonth (the clamped value, not the raw request)', async () => {
    const { db, calls } = makeFakeDb();
    await saveOnboardedUser(db as never, {
      telegramId: 123456789,
      answers: { ...baseAnswers, goal: 'loss', desiredRateKgPerMonth: 5 }, // raw request, clamped by domain
      targets: { ...baseTargets, rateKgPerMonth: 1 }, // what the domain actually used
    });

    const values = calls[0]!.values as Record<string, unknown>;
    expect(values.desiredRateKgPerMonth).toBe(1);
  });

  it('every persisted calorie/macro value is an integer', async () => {
    const { db, calls } = makeFakeDb();
    await saveOnboardedUser(db as never, {
      telegramId: 123456789,
      answers: baseAnswers,
      targets: baseTargets,
    });

    const values = calls[0]!.values as Record<string, unknown>;
    expect(Number.isInteger(values.targetKcal)).toBe(true);
    expect(Number.isInteger(values.targetProteinG)).toBe(true);
    expect(Number.isInteger(values.targetFatG)).toBe(true);
    expect(Number.isInteger(values.targetCarbsG)).toBe(true);
  });

  it('throws before touching the database if telegramId is not a positive safe integer', async () => {
    const { db, calls } = makeFakeDb();

    await expect(
      saveOnboardedUser(db as never, { telegramId: -1, answers: baseAnswers, targets: baseTargets }),
    ).rejects.toThrow();
    await expect(
      saveOnboardedUser(db as never, { telegramId: 0, answers: baseAnswers, targets: baseTargets }),
    ).rejects.toThrow();
    await expect(
      saveOnboardedUser(db as never, { telegramId: 1.5, answers: baseAnswers, targets: baseTargets }),
    ).rejects.toThrow();
    await expect(
      saveOnboardedUser(db as never, {
        telegramId: Number.MAX_SAFE_INTEGER + 10,
        answers: baseAnswers,
        targets: baseTargets,
      }),
    ).rejects.toThrow();

    expect(calls).toHaveLength(0);
  });

  it('calling twice with the same telegramId results in one call each time, no error', async () => {
    const { db, calls } = makeFakeDb();
    await saveOnboardedUser(db as never, { telegramId: 42, answers: baseAnswers, targets: baseTargets });
    await saveOnboardedUser(db as never, { telegramId: 42, answers: baseAnswers, targets: baseTargets });
    expect(calls).toHaveLength(2);
  });

  it('spies on console to assert save-user never logs profile data', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = makeFakeDb();
    await saveOnboardedUser(db as never, { telegramId: 42, answers: baseAnswers, targets: baseTargets });
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
