import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Same tagged-condition mocking approach as idempotency.test.ts/limits.test.ts:
// real eq/and/or/isNotNull/desc return opaque SQL fragments meant for
// Postgres, not for inspection in a unit test -- this mock replaces them
// with plain, tagged objects the fake `db` below can read directly, while
// asserting on column *identity* (the real exported column object) rather
// than a guessed string key.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq' as const, column, value }),
    and: (...conditions: unknown[]) => ({ kind: 'and' as const, conditions }),
    or: (...conditions: unknown[]) => ({ kind: 'or' as const, conditions }),
    isNotNull: (column: unknown) => ({ kind: 'isNotNull' as const, column }),
    desc: (column: unknown) => ({ kind: 'desc' as const, column }),
  };
});

const {
  readDraft,
  findAwaitingDraft,
  updateDraftComponents,
  setAwaitingInput,
  clearAwaitingInput,
  claimConfirm,
  claimAbandon,
} = await import('./draft-store.js');
const { diaryDrafts } = await import('../db/schema/diary-drafts.js');
const { isDraftExpired, DRAFT_TTL_HOURS } = await import('./types.js');
import type { DraftComponent } from './types.js';

type FakeRow = {
  id: number;
  userId: number;
  chatId: number;
  messageId: number;
  source: 'voice' | 'text';
  transcript: string;
  components: DraftComponent[];
  status: 'draft' | 'confirmed' | 'abandoned';
  awaitingInput: { kind: 'add_component' | 'typed_grams'; componentIndex?: number } | null;
  localDate: string | null;
  diaryId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type EqCondition = { kind: 'eq'; column: unknown; value: unknown };
type AndCondition = { kind: 'and'; conditions: Condition[] };
type OrCondition = { kind: 'or'; conditions: Condition[] };
type IsNotNullCondition = { kind: 'isNotNull'; column: unknown };
type Condition = EqCondition | AndCondition | OrCondition | IsNotNullCondition;

function columnOf(condition: EqCondition): unknown {
  return condition.column;
}

/** Flattens a (possibly nested) `and(...)`/`or(...)` tree to its leaf eq/isNotNull conditions. */
function leaves(condition: Condition): (EqCondition | IsNotNullCondition)[] {
  if (condition.kind === 'and' || condition.kind === 'or') {
    return condition.conditions.flatMap((c) => leaves(c as Condition));
  }
  return [condition];
}

function matches(condition: Condition, row: FakeRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => matches(c as Condition, row));
  }
  if (condition.kind === 'or') {
    return condition.conditions.some((c) => matches(c as Condition, row));
  }
  if (condition.kind === 'isNotNull') {
    if (condition.column === diaryDrafts.awaitingInput) return row.awaitingInput !== null;
    throw new Error('unexpected isNotNull() column in test');
  }
  // eq
  if (condition.column === diaryDrafts.id) return row.id === condition.value;
  if (condition.column === diaryDrafts.userId) return row.userId === condition.value;
  if (condition.column === diaryDrafts.status) return row.status === condition.value;
  throw new Error('unexpected eq() column in test');
}

/**
 * Hand-built fake `db` -- copies the structural-stub style of
 * `idempotency.test.ts`/`limits.test.ts`. Records the last `where` condition
 * per call so tests can assert IDOR scoping against the real, tagged
 * condition tree, not just the returned rows. Opens no real database
 * connection.
 */
function makeFakeDb(initialRows: FakeRow[] = []) {
  const rows = new Map(initialRows.map((r) => [r.id, { ...r }]));
  const lastWhere: { select?: Condition; update?: Condition } = {};

  function selectResult(condition: Condition) {
    lastWhere.select = condition;
    const filtered = [...rows.values()].filter((row) => matches(condition, row));
    return {
      orderBy(order: { kind: 'desc'; column: unknown }) {
        const sorted = [...filtered].sort((a, b) => {
          if (order.column === diaryDrafts.updatedAt) {
            return b.updatedAt.getTime() - a.updatedAt.getTime();
          }
          throw new Error('unexpected orderBy() column in test');
        });
        return {
          limit(n: number) {
            return Promise.resolve(sorted.slice(0, n).map(toSelectShape));
          },
        };
      },
      limit(n: number) {
        return Promise.resolve(filtered.slice(0, n).map(toSelectShape));
      },
    };
  }

  function toSelectShape(row: FakeRow) {
    // Mirrors draftColumns in draft-store.ts: every PersistedDraft field
    // except updatedAt.
    const { updatedAt: _updatedAt, ...rest } = row;
    return rest;
  }

  function updateResult(condition: Condition, patch: Partial<FakeRow>) {
    lastWhere.update = condition;
    const matched = [...rows.values()].filter((row) => matches(condition, row));
    const promise = Promise.resolve().then(() => {
      for (const row of matched) {
        Object.assign(row, patch);
      }
      return undefined;
    });
    return {
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
      returning(_cols: unknown) {
        return promise.then(() => matched.map((r) => ({ id: r.id })));
      },
    };
  }

  const db = {
    select(_cols: unknown) {
      return {
        from() {
          return {
            where(condition: Condition) {
              return selectResult(condition);
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: Partial<FakeRow>) {
          return {
            where(condition: Condition) {
              return updateResult(condition, patch);
            },
          };
        },
      };
    },
  };

  return { db, rows, lastWhere };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asDb(db: unknown): any {
  return db;
}

function sampleComponents(): DraftComponent[] {
  return [
    {
      component: 'куриная грудка',
      componentEn: 'chicken breast',
      grams: 150,
      candidates: [],
      chosenFdcId: null,
      weakMatch: true,
    },
  ];
}

function makeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 1,
    userId: 10,
    chatId: 100,
    messageId: 1000,
    source: 'voice',
    transcript: 'курица с рисом',
    components: sampleComponents(),
    status: 'draft',
    awaitingInput: null,
    localDate: '2026-08-15',
    diaryId: null,
    createdAt: new Date('2026-08-15T00:00:00Z'),
    updatedAt: new Date('2026-08-15T00:00:00Z'),
    ...overrides,
  };
}

describe('readDraft', () => {
  it('never selects by draft id alone -- the where clause references both id and userId', async () => {
    const { db, lastWhere } = makeFakeDb([makeRow({ id: 1, userId: 10 })]);

    await readDraft(asDb(db), 1, 10);

    expect(lastWhere.select).toBeDefined();
    const flat = leaves(lastWhere.select as Condition) as EqCondition[];
    const columns = flat.map((c) => columnOf(c));
    expect(columns).toContain(diaryDrafts.id);
    expect(columns).toContain(diaryDrafts.userId);
  });

  it('returns null for a draft belonging to a different user, and does not throw', async () => {
    const { db } = makeFakeDb([makeRow({ id: 1, userId: 10 })]);

    const result = await readDraft(asDb(db), 1, 999);

    expect(result).toBeNull();
  });

  it('returns the draft for the owning user', async () => {
    const { db } = makeFakeDb([makeRow({ id: 1, userId: 10, transcript: 'куриный суп' })]);

    const result = await readDraft(asDb(db), 1, 10);

    expect(result).not.toBeNull();
    expect(result?.transcript).toBe('куриный суп');
  });
});

describe('updateDraftComponents', () => {
  it('round-trips a DraftComponent[] through the store (CORRECT-07: handed to Postgres, not retained in memory)', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10 })]);
    const newComponents = sampleComponents();
    newComponents[0]!.grams = 200;

    const ok = await updateDraftComponents(asDb(db), 1, 10, newComponents);

    expect(ok).toBe(true);
    expect(rows.get(1)?.components).toEqual(newComponents);
  });

  it('returns false when scoped to the wrong user, and does not mutate the row', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10 })]);
    const original = rows.get(1)?.components;

    const ok = await updateDraftComponents(asDb(db), 1, 999, sampleComponents());

    expect(ok).toBe(false);
    expect(rows.get(1)?.components).toEqual(original);
  });

  it('the module holds no mutable module-scope binding (source assertion)', () => {
    const path = fileURLToPath(new URL('./draft-store.ts', import.meta.url));
    const source = readFileSync(path, 'utf-8');
    const lines = source.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^let\s/.test(trimmed) || /^const\s+cache\b/.test(trimmed)) {
        throw new Error(`found forbidden module-scope mutable binding: ${trimmed}`);
      }
    }
  });
});

describe('setAwaitingInput / clearAwaitingInput', () => {
  it('setAwaitingInput writes awaiting_input scoped by user', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10 })]);

    const ok = await setAwaitingInput(asDb(db), 1, 10, { kind: 'add_component' });

    expect(ok).toBe(true);
    expect(rows.get(1)?.awaitingInput).toEqual({ kind: 'add_component' });
  });

  it('clearAwaitingInput nulls out awaiting_input scoped by user', async () => {
    const { db, rows } = makeFakeDb([
      makeRow({ id: 1, userId: 10, awaitingInput: { kind: 'typed_grams', componentIndex: 0 } }),
    ]);

    const ok = await clearAwaitingInput(asDb(db), 1, 10);

    expect(ok).toBe(true);
    expect(rows.get(1)?.awaitingInput).toBeNull();
  });

  it('does not affect a draft belonging to a different user', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10 })]);

    const ok = await setAwaitingInput(asDb(db), 1, 999, { kind: 'add_component' });

    expect(ok).toBe(false);
    expect(rows.get(1)?.awaitingInput).toBeNull();
  });
});

describe('findAwaitingDraft', () => {
  it('orders by updatedAt descending and limits to 1', async () => {
    const { db } = makeFakeDb([
      makeRow({
        id: 1,
        userId: 10,
        awaitingInput: { kind: 'add_component' },
        updatedAt: new Date('2026-08-15T10:00:00Z'),
      }),
      makeRow({
        id: 2,
        userId: 10,
        awaitingInput: { kind: 'typed_grams', componentIndex: 0 },
        updatedAt: new Date('2026-08-15T12:00:00Z'),
      }),
    ]);

    const result = await findAwaitingDraft(asDb(db), 10);

    expect(result?.id).toBe(2);
  });

  it('returns null when no draft is awaiting input', async () => {
    const { db } = makeFakeDb([makeRow({ id: 1, userId: 10, awaitingInput: null })]);

    const result = await findAwaitingDraft(asDb(db), 10);

    expect(result).toBeNull();
  });

  it('returns a status: confirmed row with awaiting_input set (gap closure 04-13, CR-01: reopened saved entry)', async () => {
    const { db } = makeFakeDb([
      makeRow({
        id: 1,
        userId: 10,
        status: 'confirmed',
        awaitingInput: { kind: 'typed_grams', componentIndex: 0 },
      }),
    ]);

    const result = await findAwaitingDraft(asDb(db), 10);

    expect(result?.id).toBe(1);
    expect(result?.status).toBe('confirmed');
  });

  it('does not return a status: abandoned row even with a stale awaiting_input set (gap closure 04-13)', async () => {
    const { db } = makeFakeDb([
      makeRow({
        id: 1,
        userId: 10,
        status: 'abandoned',
        awaitingInput: { kind: 'typed_grams', componentIndex: 0 },
      }),
    ]);

    const result = await findAwaitingDraft(asDb(db), 10);

    expect(result).toBeNull();
  });
});

describe('isDraftExpired (D-11)', () => {
  it('a draft row created 23h59m ago is not expired', () => {
    const now = new Date('2026-08-15T23:59:00Z');
    const createdAt = new Date('2026-08-15T00:00:00Z');
    expect(isDraftExpired('draft', createdAt, now)).toBe(false);
  });

  it('a draft row created 24h01m ago is expired', () => {
    const now = new Date('2026-08-16T00:01:00Z');
    const createdAt = new Date('2026-08-15T00:00:00Z');
    expect(isDraftExpired('draft', createdAt, now)).toBe(true);
  });

  it('a confirmed row created 30 days ago is NOT expired (D-06 exemption)', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const createdAt = new Date('2026-08-15T00:00:00Z');
    expect(isDraftExpired('confirmed', createdAt, now)).toBe(false);
  });

  it('an abandoned row is not reported as expired -- status is the signal', () => {
    const now = new Date('2026-09-14T00:00:00Z');
    const createdAt = new Date('2026-08-15T00:00:00Z');
    expect(isDraftExpired('abandoned', createdAt, now)).toBe(false);
  });

  it('DRAFT_TTL_HOURS is 24', () => {
    expect(DRAFT_TTL_HOURS).toBe(24);
  });
});

describe('claimConfirm', () => {
  it('returns true and moves status to confirmed when the row is in status draft', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10, status: 'draft' })]);

    const claimed = await claimConfirm(asDb(db), 1, 10);

    expect(claimed).toBe(true);
    expect(rows.get(1)?.status).toBe('confirmed');
  });

  it('returns false without throwing when the row is already confirmed (double-tap no-op, Pitfall 3)', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10, status: 'confirmed' })]);

    const claimed = await claimConfirm(asDb(db), 1, 10);

    expect(claimed).toBe(false);
    expect(rows.get(1)?.status).toBe('confirmed');
  });
});

describe('claimAbandon', () => {
  it('claims from status draft', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10, status: 'draft' })]);

    const claimed = await claimAbandon(asDb(db), 1, 10, 'draft');

    expect(claimed).toBe(true);
    expect(rows.get(1)?.status).toBe('abandoned');
  });

  it('claims from status confirmed (delete flow, D-08)', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10, status: 'confirmed' })]);

    const claimed = await claimAbandon(asDb(db), 1, 10, 'confirmed');

    expect(claimed).toBe(true);
    expect(rows.get(1)?.status).toBe('abandoned');
  });

  it('returns false without throwing when the row is not in the expected fromStatus', async () => {
    const { db, rows } = makeFakeDb([makeRow({ id: 1, userId: 10, status: 'abandoned' })]);

    const claimed = await claimAbandon(asDb(db), 1, 10, 'draft');

    expect(claimed).toBe(false);
    expect(rows.get(1)?.status).toBe('abandoned');
  });
});
