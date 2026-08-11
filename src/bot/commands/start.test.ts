import { describe, expect, it, vi } from 'vitest';
import type { UserRow } from '../../db/schema/users.js';
import { DISCLAIMER_TEXT } from '../formatting/onboarding-copy.js';
import { buildExistingTargetsMessage, createStartHandler, RESTART_ONBOARDING_CALLBACK } from './start.js';

/**
 * Hand-written fake `db` — records the `.select().from().where().limit()`
 * chain and resolves with `rows`, exactly like `save-user.test.ts`'s
 * `makeFakeDb()`. Opens no real database connection.
 */
function makeFakeDb(rows: UserRow[]) {
  const db = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  };
  return db;
}

function makeFakeCtx(telegramId: number | undefined) {
  const replies: Array<{ text: string; opts: unknown }> = [];
  const entered: unknown[] = [];
  const ctx = {
    from: telegramId === undefined ? undefined : { id: telegramId },
    reply: vi.fn(async (text: string, opts?: unknown) => {
      replies.push({ text, opts });
    }),
    conversation: {
      enter: vi.fn(async (...args: unknown[]) => {
        entered.push(args);
      }),
    },
  };
  return { ctx, replies, entered };
}

const baseRow: UserRow = {
  id: 1,
  telegramId: 123456789,
  sex: 'male',
  ageYears: 29,
  heightCm: 178,
  weightKg: 72.5,
  activityLevel: 'medium',
  goal: 'loss',
  desiredRateKgPerMonth: 0.5,
  timezone: 'Asia/Almaty',
  targetKcal: 2379,
  targetProteinG: 131,
  targetFatG: 65,
  targetCarbsG: 251,
  onboardedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('buildExistingTargetsMessage', () => {
  it('contains all four stored numbers', () => {
    const message = buildExistingTargetsMessage(baseRow as never);
    expect(message).toContain('2379');
    expect(message).toContain('131');
    expect(message).toContain('65');
    expect(message).toContain('251');
  });

  // WR-02 regression: the returning-user screen is the most-travelled path in
  // the product and used to show calories and macros with no disclaimer at all.
  it('contains the ONBOARD-06 disclaimer verbatim', () => {
    const message = buildExistingTargetsMessage(baseRow as never);
    expect(message).toContain(DISCLAIMER_TEXT);
  });

  it('places the disclaimer after the numbers', () => {
    const message = buildExistingTargetsMessage(baseRow as never);
    expect(message.indexOf(DISCLAIMER_TEXT)).toBeGreaterThan(message.indexOf('2379'));
  });
});

describe('createStartHandler', () => {
  it('enters the conversation when there is no row for the user', async () => {
    const db = makeFakeDb([]);
    const handler = createStartHandler(db as never);
    const { ctx, replies, entered } = makeFakeCtx(999);

    await handler(ctx as never);

    expect(entered).toHaveLength(1);
    expect(replies.some((r) => r.opts === undefined)).toBe(true);
  });

  it('enters the conversation when the row exists but onboardedAt is null', async () => {
    const db = makeFakeDb([{ ...baseRow, onboardedAt: null } as UserRow]);
    const handler = createStartHandler(db as never);
    const { ctx, entered } = makeFakeCtx(123456789);

    await handler(ctx as never);

    expect(entered).toHaveLength(1);
  });

  it('shows existing targets and does not enter the conversation when fully onboarded', async () => {
    const db = makeFakeDb([baseRow]);
    const handler = createStartHandler(db as never);
    const { ctx, replies, entered } = makeFakeCtx(123456789);

    await handler(ctx as never);

    expect(entered).toHaveLength(0);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.text).toContain('2379');
    // WR-02: the message the returning user actually receives carries the disclaimer.
    expect(replies[0]!.text).toContain(DISCLAIMER_TEXT);
    const opts = replies[0]!.opts as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } };
    expect(opts.reply_markup.inline_keyboard[0]![0]!.callback_data).toBe(RESTART_ONBOARDING_CALLBACK);
  });

  it('enters the conversation when onboardedAt is set but targetKcal is null', async () => {
    const db = makeFakeDb([{ ...baseRow, targetKcal: null } as UserRow]);
    const handler = createStartHandler(db as never);
    const { ctx, entered, replies } = makeFakeCtx(123456789);

    await handler(ctx as never);

    expect(entered).toHaveLength(1);
    // Never renders null values in a reply.
    expect(replies.every((r) => !r.text.includes('null'))).toBe(true);
  });

  it('does nothing when ctx.from is undefined', async () => {
    const db = makeFakeDb([]);
    const handler = createStartHandler(db as never);
    const { ctx, entered, replies } = makeFakeCtx(undefined);

    await handler(ctx as never);

    expect(entered).toHaveLength(0);
    expect(replies).toHaveLength(0);
  });
});
