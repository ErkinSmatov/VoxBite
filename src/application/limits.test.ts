import { afterEach, describe, expect, it, vi } from 'vitest';

// Same tagged-condition mocking approach as idempotency.test.ts: real
// eq/gte/and return opaque SQL fragments, so this mock replaces them with
// plain objects the fake db below can interpret by column identity.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq' as const, column, value }),
    gte: (column: unknown, value: unknown) => ({ kind: 'gte' as const, column, value }),
    and: (...conditions: unknown[]) => ({ kind: 'and' as const, conditions }),
  };
});

const { countRecentUpdates, isDailyCapReached, findOnboardedUser } = await import('./limits.js');
const { processedUpdates } = await import('../db/schema/processed-updates.js');
const { users } = await import('../db/schema/users.js');
const { DAILY_MESSAGE_CAP } = await import('./types.js');

type FakeUpdateRow = { telegramId: number; createdAt: Date };
type FakeUserRow = { id: number; telegramId: number; onboardedAt: Date | null };

type Condition =
  | { kind: 'eq'; column: unknown; value: unknown }
  | { kind: 'gte'; column: unknown; value: unknown }
  | { kind: 'and'; conditions: Condition[] };

function matchesUpdate(condition: Condition, row: FakeUpdateRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => matchesUpdate(c, row));
  }
  if (condition.kind === 'eq') {
    if (condition.column === processedUpdates.telegramId) return row.telegramId === condition.value;
    throw new Error('unexpected eq() column in test');
  }
  if (condition.column === processedUpdates.createdAt) return row.createdAt >= (condition.value as Date);
  throw new Error('unexpected gte() column in test');
}

/**
 * Fake `db` covering both the `processedUpdates` count query and the
 * `users` lookup, in the structural-stub style of
 * `pg-storage-adapter.test.ts` / `idempotency.test.ts`.
 */
function makeFakeDb(options: {
  updateRows?: FakeUpdateRow[];
  userRows?: FakeUserRow[];
  countError?: Error;
} = {}) {
  const updateRows = options.updateRows ?? [];
  const userRows = options.userRows ?? [];

  const db = {
    select(cols: Record<string, unknown>) {
      // Distinguish the two callers by which columns were requested.
      const isCountQuery = 'value' in cols;
      const isUserQuery = 'id' in cols || Object.keys(cols).length === 0;

      if (isCountQuery) {
        return {
          from() {
            return {
              where(condition: Condition) {
                if (options.countError) {
                  return Promise.reject(options.countError);
                }
                const matched = updateRows.filter((r) => matchesUpdate(condition, r));
                return Promise.resolve([{ value: matched.length }]);
              },
            };
          },
        };
      }

      if (isUserQuery) {
        return {
          from() {
            return {
              where(condition: Condition) {
                return {
                  limit(_n: number) {
                    const results = userRows.filter((u) => {
                      if (condition.kind !== 'eq') throw new Error('unexpected condition');
                      return u.telegramId === condition.value;
                    });
                    return Promise.resolve(results.slice(0, 1));
                  },
                };
              },
            };
          },
        };
      }

      throw new Error('unrecognized select() shape in test');
    },
  };

  return { db };
}

describe('countRecentUpdates', () => {
  it('counts rows for the given telegramId within the trailing window', async () => {
    const now = Date.now();
    const { db } = makeFakeDb({
      updateRows: [
        { telegramId: 10, createdAt: new Date(now - 1000) },
        { telegramId: 10, createdAt: new Date(now - 2000) },
        { telegramId: 11, createdAt: new Date(now - 1000) }, // different user
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await countRecentUpdates(db as any, 10);

    expect(count).toBe(2);
  });

  it('defaults to a 24 hour window and accepts an override', async () => {
    const now = Date.now();
    const { db } = makeFakeDb({
      updateRows: [
        { telegramId: 10, createdAt: new Date(now - 25 * 3600_000) }, // outside 24h default
      ],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaultCount = await countRecentUpdates(db as any, 10);
    expect(defaultCount).toBe(0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const overriddenCount = await countRecentUpdates(db as any, 10, 48);
    expect(overriddenCount).toBe(1);
  });
});

describe('isDailyCapReached', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function rowsAt(count: number, telegramId = 10): FakeUpdateRow[] {
    const now = Date.now();
    return Array.from({ length: count }, () => ({ telegramId, createdAt: new Date(now - 1000) }));
  }

  it('returns false when the count is one below the cap', async () => {
    const { db } = makeFakeDb({ updateRows: rowsAt(DAILY_MESSAGE_CAP - 1) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isDailyCapReached(db as any, 10)).toBe(false);
  });

  // The caller claims the current update BEFORE counting, so on the user's
  // Nth message of the window the count is already N. A count equal to the
  // cap therefore means "this is message number DAILY_MESSAGE_CAP" — which
  // must still be allowed, or the effective cap is DAILY_MESSAGE_CAP - 1.
  it('returns false when the count equals the cap — that message is the last allowed one', async () => {
    const { db } = makeFakeDb({ updateRows: rowsAt(DAILY_MESSAGE_CAP) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isDailyCapReached(db as any, 10)).toBe(false);
  });

  it('returns true one past the cap', async () => {
    const { db } = makeFakeDb({ updateRows: rowsAt(DAILY_MESSAGE_CAP + 1) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isDailyCapReached(db as any, 10)).toBe(true);
  });

  it('returns true when the count exceeds the cap', async () => {
    const { db } = makeFakeDb({ updateRows: rowsAt(DAILY_MESSAGE_CAP + 5) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await isDailyCapReached(db as any, 10)).toBe(true);
  });

  it('returns false and logs when the count query throws (fail open)', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { db } = makeFakeDb({ countError: new Error('connection reset') });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await isDailyCapReached(db as any, 10);

    expect(result).toBe(false);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedLine = logSpy.mock.calls[0]?.[0] as string;
    expect(loggedLine).not.toContain('10'); // no telegram id
    expect(loggedLine).not.toContain('connection reset'); // no raw message content leak beyond failure kind
  });
});

describe('findOnboardedUser', () => {
  it('returns { id } for a user row whose onboardedAt is not null', async () => {
    const { db } = makeFakeDb({
      userRows: [{ id: 7, telegramId: 111, onboardedAt: new Date() }],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findOnboardedUser(db as any, 111);

    expect(result).toEqual({ id: 7 });
  });

  it('returns null when no user row exists', async () => {
    const { db } = makeFakeDb({ userRows: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findOnboardedUser(db as any, 999);

    expect(result).toBeNull();
  });

  it('returns null when the row exists but onboardedAt is null', async () => {
    const { db } = makeFakeDb({
      userRows: [{ id: 8, telegramId: 222, onboardedAt: null }],
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findOnboardedUser(db as any, 222);

    expect(result).toBeNull();
  });
});
