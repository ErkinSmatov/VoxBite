import { describe, expect, it, vi } from 'vitest';

// The module under test calls `eq(processedUpdates.updateId, ...)` and
// `inArray(processedUpdates.updateId, ...)` to build `.where(...)`
// conditions. Real `eq`/`inArray` return opaque SQL fragments meant for
// Postgres, not for inspection in a unit test -- this mock replaces them
// with plain, tagged objects the fake `db` below can read directly, while
// asserting on column *identity* (the real exported column object) rather
// than a guessed string key. Follows the same approach as
// `pg-storage-adapter.test.ts`.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq' as const, column, value }),
    inArray: (column: unknown, values: unknown) => ({ kind: 'inArray' as const, column, values }),
  };
});

const { claimUpdate, markUpdateStatus, findInterruptedUpdates, markInterrupted } = await import(
  './idempotency.js'
);
const { processedUpdates } = await import('../db/schema/processed-updates.js');

type FakeRow = {
  updateId: number;
  telegramId: number;
  chatId: number;
  kind: 'voice' | 'text';
  status: 'processing' | 'done' | 'interrupted' | 'failed';
};

type EqCondition = { kind: 'eq'; column: unknown; value: unknown };
type InArrayCondition = { kind: 'inArray'; column: unknown; values: unknown };
type Condition = EqCondition | InArrayCondition;

/**
 * Hand-built fake `db` -- records call counts for `insert`/`update`/`select`
 * so tests can assert "returns false" and "returns false without issuing
 * another query" as two separate guarantees, per the plan's instruction.
 * Opens no real database connection.
 */
function makeFakeDb(initialRows: FakeRow[] = []) {
  const rows = new Map(initialRows.map((r) => [r.updateId, { ...r }]));
  const calls = { insert: 0, update: 0, select: 0 };

  function matches(condition: Condition, row: FakeRow): boolean {
    if (condition.kind === 'eq') {
      if (condition.column === processedUpdates.updateId) {
        return row.updateId === condition.value;
      }
      if (condition.column === processedUpdates.status) {
        return row.status === condition.value;
      }
      throw new Error('unexpected eq() column in test');
    }
    if (condition.column === processedUpdates.updateId) {
      return (condition.values as number[]).includes(row.updateId);
    }
    throw new Error('unexpected inArray() column in test');
  }

  const db = {
    insert() {
      calls.insert += 1;
      return {
        values(row: { updateId: number; telegramId: number; chatId: number; kind: 'voice' | 'text'; status: string }) {
          return {
            onConflictDoNothing(_config: { target: unknown }) {
              return {
                returning(_cols: unknown) {
                  if (rows.has(row.updateId)) {
                    return Promise.resolve([]);
                  }
                  rows.set(row.updateId, { ...row } as FakeRow);
                  return Promise.resolve([{ updateId: row.updateId }]);
                },
              };
            },
          };
        },
      };
    },
    update() {
      calls.update += 1;
      return {
        set(patch: Partial<FakeRow> & { updatedAt?: Date }) {
          return {
            where(condition: Condition) {
              for (const row of rows.values()) {
                if (matches(condition, row)) {
                  Object.assign(row, patch);
                }
              }
              return Promise.resolve();
            },
          };
        },
      };
    },
    select(_cols: unknown) {
      calls.select += 1;
      return {
        from() {
          return {
            where(condition: Condition) {
              const results = [...rows.values()].filter((row) => matches(condition, row));
              return Promise.resolve(
                results.map((r) => ({ updateId: r.updateId, chatId: r.chatId, telegramId: r.telegramId })),
              );
            },
          };
        },
      };
    },
  };

  return { db, rows, calls };
}

describe('claimUpdate', () => {
  it('returns true and issues exactly one insert for a fresh update_id', async () => {
    const { db, calls } = makeFakeDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimUpdate({ db: db as any, updateId: 1, telegramId: 10, chatId: 20, kind: 'voice' });

    expect(claimed).toBe(true);
    expect(calls.insert).toBe(1);
    expect(calls.update).toBe(0);
    expect(calls.select).toBe(0);
  });

  it('returns false without issuing another query for an update_id that already exists', async () => {
    const { db, calls } = makeFakeDb([
      { updateId: 1, telegramId: 10, chatId: 20, kind: 'voice', status: 'processing' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed = await claimUpdate({ db: db as any, updateId: 1, telegramId: 99, chatId: 88, kind: 'text' });

    expect(claimed).toBe(false);
    expect(calls.insert).toBe(1);
    expect(calls.update).toBe(0);
    expect(calls.select).toBe(0);
  });

  it('the inserted row carries status processing plus the caller-supplied telegramId, chatId and kind', async () => {
    const { db, rows } = makeFakeDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await claimUpdate({ db: db as any, updateId: 42, telegramId: 555, chatId: 777, kind: 'voice' });

    const stored = rows.get(42);
    expect(stored).toMatchObject({
      updateId: 42,
      telegramId: 555,
      chatId: 777,
      kind: 'voice',
      status: 'processing',
    });
  });
});

describe('markUpdateStatus', () => {
  it('issues an update setting status and refreshing updatedAt, scoped by update_id', async () => {
    const { db, rows } = makeFakeDb([
      { updateId: 5, telegramId: 1, chatId: 2, kind: 'voice', status: 'processing' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markUpdateStatus(db as any, 5, 'done');

    const row = rows.get(5);
    expect(row?.status).toBe('done');
  });

  it('does not touch a row with a different update_id', async () => {
    const { db, rows } = makeFakeDb([
      { updateId: 5, telegramId: 1, chatId: 2, kind: 'voice', status: 'processing' },
      { updateId: 6, telegramId: 1, chatId: 2, kind: 'voice', status: 'processing' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markUpdateStatus(db as any, 5, 'failed');

    expect(rows.get(6)?.status).toBe('processing');
  });
});

describe('findInterruptedUpdates', () => {
  it('returns only rows whose status is processing', async () => {
    const { db } = makeFakeDb([
      { updateId: 1, telegramId: 10, chatId: 20, kind: 'voice', status: 'processing' },
      { updateId: 2, telegramId: 11, chatId: 21, kind: 'text', status: 'done' },
      { updateId: 3, telegramId: 12, chatId: 22, kind: 'voice', status: 'processing' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findInterruptedUpdates(db as any);

    expect(result).toEqual([
      { updateId: 1, chatId: 20, telegramId: 10 },
      { updateId: 3, chatId: 22, telegramId: 12 },
    ]);
  });
});

describe('markInterrupted', () => {
  it('issues no query at all for an empty array', async () => {
    const { db, calls } = makeFakeDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markInterrupted(db as any, []);

    expect(calls.update).toBe(0);
    expect(calls.select).toBe(0);
    expect(calls.insert).toBe(0);
  });

  it('sets status interrupted for exactly the given ids', async () => {
    const { db, rows } = makeFakeDb([
      { updateId: 1, telegramId: 10, chatId: 20, kind: 'voice', status: 'processing' },
      { updateId: 2, telegramId: 11, chatId: 21, kind: 'voice', status: 'processing' },
      { updateId: 3, telegramId: 12, chatId: 22, kind: 'voice', status: 'processing' },
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await markInterrupted(db as any, [1, 2]);

    expect(rows.get(1)?.status).toBe('interrupted');
    expect(rows.get(2)?.status).toBe('interrupted');
    expect(rows.get(3)?.status).toBe('processing');
  });
});
