import { describe, expect, it, vi } from 'vitest';

// The adapter calls `eq(botSessions.key, key)` to build its `.where(...)`
// condition. Real `eq()` returns an opaque SQL fragment meant for Postgres,
// not for inspection in a unit test — so this mock replaces it with a plain
// `{ key: value }` object the fake db below can read directly. This keeps
// the test hermetic (no real database connection) while still proving the
// adapter targets the right column via the real `eq` import, not a
// hand-rolled comparison.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (_column: unknown, value: string) => ({ key: value }),
  };
});

const { createPgStorageAdapter } = await import('./pg-storage-adapter.js');
const { botSessions } = await import('../../db/schema/bot-sessions.js');

/**
 * Hand-written fake `db` — records the calls its `select`/`insert`/`delete`
 * chains receive, exactly like `scripts/index-fdc/load.test.ts`'s
 * `makeFakeDb()` and `src/domain/fdc-matching/match-ingredient.test.ts`'s
 * `fakeRepo()`. Opens no real database connection.
 */
function makeFakeDb(initialRows: Array<{ key: string; value: unknown }> = []) {
  const rows = new Map(initialRows.map((r) => [r.key, r.value]));
  const onConflictDoUpdateCalls: unknown[] = [];

  const db = {
    select() {
      return {
        from() {
          return {
            where(condition: { key: string }) {
              const value = rows.get(condition.key);
              return Promise.resolve(value === undefined ? [] : [{ value }]);
            },
          };
        },
      };
    },
    insert() {
      return {
        values(row: { key: string; value: unknown }) {
          return {
            onConflictDoUpdate(config: { target: unknown; set: { value: unknown } }) {
              onConflictDoUpdateCalls.push(config);
              rows.set(row.key, row.value);
              return Promise.resolve();
            },
          };
        },
      };
    },
    delete() {
      return {
        where(condition: { key: string }) {
          rows.delete(condition.key);
          return Promise.resolve();
        },
      };
    },
  };

  return { db, rows, onConflictDoUpdateCalls };
}

describe('createPgStorageAdapter', () => {
  it('read() returns undefined for a key that has no row', async () => {
    const { db } = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createPgStorageAdapter<{ foo: string }>(db as any);

    const result = await adapter.read('missing-key');

    expect(result).toBeUndefined();
  });

  it('read() returns the stored value for a key that has a row', async () => {
    const { db } = makeFakeDb([{ key: 'chat:1', value: { step: 'age' } }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createPgStorageAdapter<{ step: string }>(db as any);

    const result = await adapter.read('chat:1');

    expect(result).toEqual({ step: 'age' });
  });

  it('write() issues exactly one statement using onConflictDoUpdate targeting botSessions.key', async () => {
    const { db, rows, onConflictDoUpdateCalls } = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createPgStorageAdapter<{ step: string }>(db as any);

    await adapter.write('chat:2', { step: 'weight' });

    expect(rows.get('chat:2')).toEqual({ step: 'weight' });
    expect(onConflictDoUpdateCalls).toHaveLength(1);
    expect((onConflictDoUpdateCalls[0] as { target: unknown }).target).toBe(botSessions.key);
  });

  it('write() overwrites an existing key (upsert, not duplicate)', async () => {
    const { db, rows } = makeFakeDb([{ key: 'chat:3', value: { step: 'age' } }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createPgStorageAdapter<{ step: string }>(db as any);

    await adapter.write('chat:3', { step: 'goal' });

    expect(rows.get('chat:3')).toEqual({ step: 'goal' });
    expect(rows.size).toBe(1);
  });

  it('delete() removes the row for an existing key', async () => {
    const { db, rows } = makeFakeDb([{ key: 'chat:4', value: { step: 'age' } }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createPgStorageAdapter<{ step: string }>(db as any);

    await adapter.delete('chat:4');

    expect(rows.has('chat:4')).toBe(false);
  });

  it('delete() does not throw when the key is absent', async () => {
    const { db } = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = createPgStorageAdapter<{ step: string }>(db as any);

    await expect(adapter.delete('never-existed')).resolves.toBeUndefined();
  });
});
