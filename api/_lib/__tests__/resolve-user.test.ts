import { describe, expect, it, vi } from 'vitest';

// Same tagged-condition mocking approach as src/application/limits.test.ts:
// real eq() returns an opaque SQL fragment, so this mock replaces it with a
// plain object the fake db below can interpret by column identity.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq' as const, column, value }),
  };
});

const { resolveUser } = await import('../resolve-user');
const { users } = await import('../../../src/db/schema/users');

type FakeUserRow = { id: number; telegramId: number; onboardedAt: Date | null; timezone: string };
type Condition = { kind: 'eq'; column: unknown; value: unknown };

function makeFakeDb(userRows: FakeUserRow[]) {
  let selectCalls = 0;
  const db = {
    select(_cols: Record<string, unknown>) {
      selectCalls += 1;
      return {
        from() {
          return {
            where(condition: Condition) {
              return {
                limit(_n: number) {
                  const results = userRows.filter((u) => {
                    if (condition.column !== users.telegramId) {
                      throw new Error('unexpected eq() column in test');
                    }
                    return u.telegramId === condition.value;
                  });
                  return Promise.resolve(results.slice(0, 1));
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, getSelectCalls: () => selectCalls };
}

describe('resolveUser', () => {
  it('returns null without querying the database when telegramId is undefined', async () => {
    const { db, getSelectCalls } = makeFakeDb([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveUser(db as any, undefined);
    expect(result).toBeNull();
    expect(getSelectCalls()).toBe(0);
  });

  it('delegates to findOnboardedUser and returns its result', async () => {
    const { db } = makeFakeDb([{ id: 7, telegramId: 123, onboardedAt: new Date(), timezone: 'Asia/Almaty' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveUser(db as any, 123);
    expect(result).toEqual({ id: 7, timezone: 'Asia/Almaty' });
  });

  it('returns null for a telegram id with no onboarded users row', async () => {
    const { db } = makeFakeDb([{ id: 7, telegramId: 123, onboardedAt: null, timezone: 'Asia/Almaty' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await resolveUser(db as any, 123);
    expect(result).toBeNull();
  });
});
