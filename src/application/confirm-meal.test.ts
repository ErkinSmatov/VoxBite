import { describe, expect, it, vi } from 'vitest';

// Same tagged-condition mocking approach as draft-store.test.ts/idempotency.test.ts:
// real eq/and return opaque SQL fragments meant for Postgres, not for
// inspection in a unit test -- this mock replaces them with plain, tagged
// objects the fake `db` below can read directly, asserting on column
// *identity* (the real exported column object) rather than a guessed
// string key. Applies transitively to draft-store.ts too, since it also
// imports drizzle-orm and this module calls into it.
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

const { confirmMeal, findBlockingComponent, buildDiaryDescription } = await import('./confirm-meal.js');
const { diaryDrafts } = await import('../db/schema/diary-drafts.js');
const { diary } = await import('../db/schema/diary.js');
import type { DraftComponent, PersistedDraft } from './types.js';
import type { FdcCandidate } from '../domain/fdc-matching/index.js';

// ---------------------------------------------------------------------------
// Fake Db -- supports the exact drizzle chains confirm-meal.ts and
// draft-store.ts issue: select/update on diaryDrafts, insert on diary. No
// real connection is opened. (Extended in Task 2 to also support update()
// and delete() on diary, for recomputeSavedEntry/deleteSavedEntry.)
// ---------------------------------------------------------------------------

type EqCondition = { kind: 'eq'; column: unknown; value: unknown };
type AndCondition = { kind: 'and'; conditions: Condition[] };
type Condition = EqCondition | AndCondition;

type DraftRow = {
  id: number;
  userId: number;
  chatId: number;
  messageId: number;
  source: 'voice' | 'text';
  transcript: string;
  components: DraftComponent[];
  status: 'draft' | 'confirmed' | 'abandoned';
  awaitingInput: null;
  localDate: string | null;
  diaryId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type DiaryRow = {
  id: number;
  userId: number;
  localDate: string;
  description: string;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  draftId: number;
};

function matchesDraft(condition: Condition, row: DraftRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => matchesDraft(c as Condition, row));
  }
  if (condition.column === diaryDrafts.id) return row.id === condition.value;
  if (condition.column === diaryDrafts.userId) return row.userId === condition.value;
  if (condition.column === diaryDrafts.status) return row.status === condition.value;
  throw new Error('unexpected eq() column against diaryDrafts in test');
}

function makeFakeDb(initialDrafts: DraftRow[] = []) {
  const draftRows = new Map(initialDrafts.map((r) => [r.id, { ...r }]));
  const diaryRows = new Map<number, DiaryRow>();
  let nextDiaryId = 1;

  const diaryInserts: unknown[] = [];

  function toDraftSelectShape(row: DraftRow) {
    const { updatedAt: _updatedAt, ...rest } = row;
    return rest;
  }

  const db = {
    select(_cols: unknown) {
      return {
        from(table: unknown) {
          if (table !== diaryDrafts) {
            throw new Error('unexpected select().from() table in test');
          }
          return {
            where(condition: Condition) {
              const filtered = [...draftRows.values()].filter((row) => matchesDraft(condition, row));
              return {
                limit(n: number) {
                  return Promise.resolve(filtered.slice(0, n).map(toDraftSelectShape));
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      if (table !== diaryDrafts) {
        throw new Error('unexpected update() table in test');
      }
      return {
        set(patch: Partial<DraftRow>) {
          return {
            where(condition: Condition) {
              const matched = [...draftRows.values()].filter((row) => matchesDraft(condition, row));
              const promise = Promise.resolve().then(() => {
                for (const row of matched) Object.assign(row, patch);
                return undefined;
              });
              return {
                then: promise.then.bind(promise),
                catch: promise.catch.bind(promise),
                finally: promise.finally.bind(promise),
                returning(_c: unknown) {
                  return promise.then(() => matched.map((r) => ({ id: r.id })));
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      if (table !== diary) {
        throw new Error('unexpected insert() table in test');
      }
      return {
        values(row: Omit<DiaryRow, 'id'>) {
          diaryInserts.push(row);
          return {
            returning: async (_c: unknown) => {
              const id = nextDiaryId++;
              diaryRows.set(id, { id, ...row });
              return [{ id }];
            },
          };
        },
      };
    },
  };

  return { db, draftRows, diaryRows, diaryInserts };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asDb(db: unknown): any {
  return db;
}

function candidate(overrides: Partial<FdcCandidate> = {}): FdcCandidate {
  return {
    fdcId: 1,
    description: 'Chicken, broilers or fryers, breast, meat only, raw',
    source: 'foundation_food',
    kcal: 120,
    proteinG: 22.5,
    fatG: 2.6,
    carbsG: 0,
    sugarG: null,
    similarity: 0.9,
    ...overrides,
  };
}

function component(overrides: Partial<DraftComponent> = {}): DraftComponent {
  const candidates = overrides.candidates ?? [candidate()];
  return {
    component: 'куриная грудка',
    componentEn: 'chicken breast',
    grams: 150,
    candidates,
    chosenFdcId: candidates[0]?.fdcId ?? null,
    weakMatch: false,
    ...overrides,
  };
}

function threeMatchedComponents(): DraftComponent[] {
  return [
    component({
      component: 'куриная грудка',
      grams: 150,
      candidates: [candidate({ fdcId: 1, kcal: 120, proteinG: 22.5, fatG: 2.6, carbsG: 0, sugarG: null })],
      chosenFdcId: 1,
    }),
    component({
      component: 'рис',
      grams: 100,
      candidates: [candidate({ fdcId: 2, kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28, sugarG: 0.1 })],
      chosenFdcId: 2,
    }),
    component({
      component: 'брокколи',
      grams: 80,
      candidates: [candidate({ fdcId: 3, kcal: 34, proteinG: 2.8, fatG: 0.4, carbsG: 6.6, sugarG: 1.7 })],
      chosenFdcId: 3,
    }),
  ];
}

function makeDraftRow(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 1,
    userId: 10,
    chatId: 100,
    messageId: 1000,
    source: 'voice',
    transcript: 'курица с рисом и брокколи',
    components: threeMatchedComponents(),
    status: 'draft',
    awaitingInput: null,
    localDate: '2026-08-15',
    diaryId: null,
    createdAt: new Date('2026-08-15T10:00:00Z'),
    updatedAt: new Date('2026-08-15T10:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-08-15T10:05:00Z');

// ---------------------------------------------------------------------------
// findBlockingComponent / buildDiaryDescription
// ---------------------------------------------------------------------------

describe('findBlockingComponent', () => {
  it('returns null when every component has a chosenFdcId', () => {
    expect(findBlockingComponent(threeMatchedComponents())).toBeNull();
  });

  it('returns the first component whose chosenFdcId is null', () => {
    const comps = [
      component({ component: 'ok', chosenFdcId: 1 }),
      component({ component: 'missing', candidates: [], chosenFdcId: null }),
    ];
    expect(findBlockingComponent(comps)?.component).toBe('missing');
  });

  it('does not block on a weak match -- only a missing one', () => {
    const comps = [component({ component: 'weak', chosenFdcId: 1, weakMatch: true })];
    expect(findBlockingComponent(comps)).toBeNull();
  });
});

describe('buildDiaryDescription', () => {
  function draft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
    return {
      id: 1,
      userId: 10,
      chatId: 100,
      messageId: 1000,
      source: 'voice',
      transcript: '  курица с рисом  ',
      components: threeMatchedComponents(),
      status: 'draft',
      awaitingInput: null,
      localDate: '2026-08-15',
      diaryId: null,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('uses the trimmed transcript when present', () => {
    expect(buildDiaryDescription(draft())).toBe('курица с рисом');
  });

  it('falls back to comma-joined component names when the transcript is empty', () => {
    const result = buildDiaryDescription(draft({ transcript: '   ' }));
    expect(result).toBe('куриная грудка, рис, брокколи');
  });

  it('falls back to a fixed neutral label when both transcript and components are empty', () => {
    const result = buildDiaryDescription(draft({ transcript: '', components: [] }));
    expect(result.length).toBeGreaterThan(0);
  });

  it('never returns an empty string', () => {
    expect(buildDiaryDescription(draft({ transcript: '' })).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// confirmMeal
// ---------------------------------------------------------------------------

describe('confirmMeal', () => {
  it('inserts exactly one diary row whose totals equal calculateTotal for the same components', async () => {
    const { db, diaryRows, diaryInserts } = makeFakeDb([makeDraftRow()]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result.ok).toBe(true);
    expect(diaryInserts).toHaveLength(1);
    expect(diaryRows.size).toBe(1);
    const row = [...diaryRows.values()][0]!;
    // 150g chicken (120kcal/100g) + 100g rice (130kcal/100g) + 80g broccoli (34kcal/100g)
    expect(row.kcal).toBeCloseTo(150 * 1.2 + 100 * 1.3 + 80 * 0.34, 5);
  });

  it('stores sugarG as exactly null (toBeNull, not falsy) when every component lacks sugar data', async () => {
    const comps = [
      component({ candidates: [candidate({ fdcId: 1, sugarG: null })], chosenFdcId: 1 }),
      component({ candidates: [candidate({ fdcId: 2, sugarG: null })], chosenFdcId: 2 }),
    ];
    const { db, diaryRows } = makeFakeDb([makeDraftRow({ components: comps })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result.ok).toBe(true);
    const row = [...diaryRows.values()][0]!;
    expect(row.sugarG).toBeNull();
  });

  it('stores the partial sum (lower bound) when one of three components lacks sugar, and still inserts', async () => {
    const comps = [
      component({ candidates: [candidate({ fdcId: 1, sugarG: 2 })], chosenFdcId: 1, grams: 100 }),
      component({ candidates: [candidate({ fdcId: 2, sugarG: 3 })], chosenFdcId: 2, grams: 100 }),
      component({ candidates: [candidate({ fdcId: 3, sugarG: null })], chosenFdcId: 3, grams: 100 }),
    ];
    const { db, diaryRows } = makeFakeDb([makeDraftRow({ components: comps })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result.ok).toBe(true);
    const row = [...diaryRows.values()][0]!;
    expect(row.sugarG).toBeCloseTo(5, 5);
  });

  it("copies the draft's stored local_date verbatim into the diary row", async () => {
    const { db } = makeFakeDb([makeDraftRow({ localDate: '2026-08-14' })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.localDate).toBe('2026-08-14');
    }
  });

  it('refuses with blocked and names the component when one has no FDC match at all (D-10)', async () => {
    const comps = [
      component({ component: 'ok', chosenFdcId: 1 }),
      component({ component: 'мистери-соус', candidates: [], chosenFdcId: null }),
    ];
    const { db, diaryInserts, draftRows } = makeFakeDb([makeDraftRow({ components: comps })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result).toEqual({ ok: false, reason: 'blocked', blockedComponent: 'мистери-соус' });
    expect(diaryInserts).toHaveLength(0);
    expect(draftRows.get(1)?.status).toBe('draft');
  });

  it('refuses an empty-components draft; no diary row is inserted (D-12)', async () => {
    const { db, diaryInserts } = makeFakeDb([makeDraftRow({ components: [] })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result).toEqual({ ok: false, reason: 'empty' });
    expect(diaryInserts).toHaveLength(0);
  });

  it('refuses a draft whose local_date is null (pre-Phase-4 leftover); no diary row is inserted', async () => {
    const { db, diaryInserts } = makeFakeDb([makeDraftRow({ localDate: null })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result).toEqual({ ok: false, reason: 'no_local_date' });
    expect(diaryInserts).toHaveLength(0);
  });

  it('reports already_confirmed with zero inserts when claimConfirm loses the race (double tap, Pitfall 3)', async () => {
    const { db, diaryInserts } = makeFakeDb([makeDraftRow({ status: 'confirmed' })]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result).toEqual({ ok: false, reason: 'already_confirmed' });
    expect(diaryInserts).toHaveLength(0);
  });

  it("sets the inserted row's draftId to the draft id and calls linkDiaryRow with the inserted diary id", async () => {
    const { db, diaryRows, draftRows } = makeFakeDb([makeDraftRow({ id: 7 })]);

    const result = await confirmMeal(asDb(db), 7, 10, NOW);

    expect(result.ok).toBe(true);
    const row = [...diaryRows.values()][0]!;
    expect(row.draftId).toBe(7);
    if (result.ok) {
      expect(draftRows.get(7)?.diaryId).toBe(result.diaryId);
    }
  });

  it('refuses a draft belonging to another user with no read of, and no write to, diary', async () => {
    const { db, diaryInserts } = makeFakeDb([makeDraftRow({ id: 1, userId: 10 })]);

    const result = await confirmMeal(asDb(db), 1, 999, NOW);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(diaryInserts).toHaveLength(0);
  });

  it('reports not_found for a nonexistent draft', async () => {
    const { db } = makeFakeDb([]);

    const result = await confirmMeal(asDb(db), 999, 10, NOW);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports expired for a stale draft (D-11)', async () => {
    const { db, diaryInserts } = makeFakeDb([
      makeDraftRow({ createdAt: new Date('2026-08-01T00:00:00Z') }),
    ]);

    const result = await confirmMeal(asDb(db), 1, 10, NOW);

    expect(result).toEqual({ ok: false, reason: 'expired' });
    expect(diaryInserts).toHaveLength(0);
  });
});
