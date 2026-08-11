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

  // Regression test for the Phase 2 manual-verification bug: session() and
  // conversations() both default to `ctx.chatId` as the raw storage key, so
  // two adapters built over the same table without a keyPrefix would read
  // and overwrite each other's rows for the same logical chat. Namespacing
  // must keep them fully isolated even for the identical raw key.
  it('two adapters with different keyPrefix values do not observe each other\'s writes for the same logical key', async () => {
    const { db, rows } = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionAdapter = createPgStorageAdapter<{ kind: 'session' }>(db as any, 'sess:');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversationAdapter = createPgStorageAdapter<{ kind: 'conversation'; version: unknown[] }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
      'conv:',
    );
    const sharedRawKey = '999999999'; // stand-in for a real chat ID both plugins derive by default

    // session() writes its plain initial value first, as it does on every
    // request before the conversations plugin runs.
    await sessionAdapter.write(sharedRawKey, { kind: 'session' });

    // conversations() then reads for the same raw key — before the fix,
    // this returned the session's plain `{}`-shaped value and its
    // unpack() would throw "Unknown data format, cannot parse version".
    const conversationRead = await conversationAdapter.read(sharedRawKey);
    expect(conversationRead).toBeUndefined();

    await conversationAdapter.write(sharedRawKey, { kind: 'conversation', version: [1] });

    // Each adapter must only ever see its own namespaced row.
    await expect(sessionAdapter.read(sharedRawKey)).resolves.toEqual({ kind: 'session' });
    await expect(conversationAdapter.read(sharedRawKey)).resolves.toEqual({
      kind: 'conversation',
      version: [1],
    });

    // Underlying table has two distinct rows, not one shared row.
    expect(rows.size).toBe(2);
    expect(rows.has('sess:999999999')).toBe(true);
    expect(rows.has('conv:999999999')).toBe(true);
  });
});
