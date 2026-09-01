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

const { confirmMeal, recomputeSavedEntry, deleteSavedEntry, findBlockingComponent, buildDiaryDescription } =
  await import('./confirm-meal.js');
const { diaryDrafts } = await import('../db/schema/diary-drafts.js');
const { diary } = await import('../db/schema/diary.js');
import type { DraftComponent, PersistedDraft } from './types.js';
import type { FdcCandidate } from '../domain/fdc-matching/index.js';

// ---------------------------------------------------------------------------
// Fake Db -- supports the exact drizzle chains confirm-meal.ts and
// draft-store.ts issue: select/update on diaryDrafts, insert/update/delete
// on diary. No real connection is opened.
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

function leaves(condition: Condition): EqCondition[] {
  if (condition.kind === 'and') {
    return condition.conditions.flatMap((c) => leaves(c as Condition));
  }
  return [condition];
}

function matchesDraft(condition: Condition, row: DraftRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => matchesDraft(c as Condition, row));
  }
  if (condition.column === diaryDrafts.id) return row.id === condition.value;
  if (condition.column === diaryDrafts.userId) return row.userId === condition.value;
  if (condition.column === diaryDrafts.status) return row.status === condition.value;
  throw new Error('unexpected eq() column against diaryDrafts in test');
}

function matchesDiary(condition: Condition, row: DiaryRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => matchesDiary(c as Condition, row));
  }
  if (condition.column === diary.id) return row.id === condition.value;
  if (condition.column === diary.userId) return row.userId === condition.value;
  throw new Error('unexpected eq() column against diary in test');
}

function makeFakeDb(initialDrafts: DraftRow[] = [], initialDiaryRows: DiaryRow[] = []) {
  const draftRows = new Map(initialDrafts.map((r) => [r.id, { ...r }]));
  const diaryRows = new Map(initialDiaryRows.map((r) => [r.id, { ...r }]));
  let nextDiaryId = diaryRows.size === 0 ? 1 : Math.max(...diaryRows.keys()) + 1;

  const diaryInserts: unknown[] = [];
  const diaryUpdates: Partial<DiaryRow>[] = [];
  const diaryDeleteWhereColumns: unknown[][] = [];
  const diaryUpdateWhereColumns: unknown[][] = [];

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
      if (table === diaryDrafts) {
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
      }
      if (table === diary) {
        return {
          set(patch: Partial<DiaryRow>) {
            diaryUpdates.push(patch);
            return {
              where(condition: Condition) {
                diaryUpdateWhereColumns.push(leaves(condition).map((c) => c.column));
                const matched = [...diaryRows.values()].filter((row) => matchesDiary(condition, row));
                return Promise.resolve().then(() => {
                  for (const row of matched) Object.assign(row, patch);
                  return undefined;
                });
              },
            };
          },
        };
      }
      throw new Error('unexpected update() table in test');
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
    delete(table: unknown) {
      if (table !== diary) {
        throw new Error('unexpected delete() table in test');
      }
      return {
        where(condition: Condition) {
          diaryDeleteWhereColumns.push(leaves(condition).map((c) => c.column));
          const matched = [...diaryRows.values()].filter((row) => matchesDiary(condition, row));
          for (const row of matched) diaryRows.delete(row.id);
          return Promise.resolve();
        },
      };
    },
  };

  return {
    db,
    draftRows,
    diaryRows,
    diaryInserts,
    diaryUpdates,
    diaryDeleteWhereColumns,
    diaryUpdateWhereColumns,
  };
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

// ---------------------------------------------------------------------------
// recomputeSavedEntry (editSaved, CORRECT-08)
// ---------------------------------------------------------------------------

describe('recomputeSavedEntry (editSaved)', () => {
  it('editSaved: UPDATEs the linked diary row to calculateTotal of the new components, issues no INSERT', async () => {
    const savedDiaryRow: DiaryRow = {
      id: 50,
      userId: 10,
      localDate: '2026-08-15',
      description: 'курица с рисом и брокколи',
      kcal: 1,
      proteinG: 1,
      fatG: 1,
      carbsG: 1,
      sugarG: 1,
      draftId: 1,
    };
    const changedComponents = [
      component({ candidates: [candidate({ fdcId: 1, kcal: 200 })], chosenFdcId: 1, grams: 100 }),
    ];
    const { db, diaryRows, diaryInserts } = makeFakeDb(
      [makeDraftRow({ status: 'confirmed', diaryId: 50, components: changedComponents })],
      [savedDiaryRow],
    );

    const result = await recomputeSavedEntry(asDb(db), 1, 10);

    expect(result).toEqual({ ok: true, diaryId: 50 });
    expect(diaryInserts).toHaveLength(0);
    expect(diaryRows.get(50)?.kcal).toBeCloseTo(200, 5);
  });

  it('editSaved: never changes the diary row\'s localDate -- the update payload has no localDate key (D-07)', async () => {
    const savedDiaryRow: DiaryRow = {
      id: 50,
      userId: 10,
      localDate: '2026-08-01',
      description: 'x',
      kcal: 1,
      proteinG: 1,
      fatG: 1,
      carbsG: 1,
      sugarG: 1,
      draftId: 1,
    };
    const { db, diaryUpdates, diaryRows } = makeFakeDb(
      [makeDraftRow({ status: 'confirmed', diaryId: 50 })],
      [savedDiaryRow],
    );

    await recomputeSavedEntry(asDb(db), 1, 10);

    expect(diaryUpdates).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(diaryUpdates[0], 'localDate')).toBe(false);
    expect(diaryRows.get(50)?.localDate).toBe('2026-08-01');
  });

  it('editSaved: refuses with blocked when a component now has no FDC match, leaving the diary row untouched', async () => {
    const savedDiaryRow: DiaryRow = {
      id: 50,
      userId: 10,
      localDate: '2026-08-15',
      description: 'x',
      kcal: 42,
      proteinG: 1,
      fatG: 1,
      carbsG: 1,
      sugarG: 1,
      draftId: 1,
    };
    const nowBlocked = [component({ component: 'потерялся', candidates: [], chosenFdcId: null })];
    const { db, diaryRows, diaryUpdates } = makeFakeDb(
      [makeDraftRow({ status: 'confirmed', diaryId: 50, components: nowBlocked })],
      [savedDiaryRow],
    );

    const result = await recomputeSavedEntry(asDb(db), 1, 10);

    expect(result).toEqual({ ok: false, reason: 'blocked', blockedComponent: 'потерялся' });
    expect(diaryUpdates).toHaveLength(0);
    expect(diaryRows.get(50)?.kcal).toBe(42);
  });

  it('editSaved: refuses without writing when the draft status is not confirmed', async () => {
    const { db, diaryUpdates } = makeFakeDb([makeDraftRow({ status: 'draft', diaryId: null })]);

    const result = await recomputeSavedEntry(asDb(db), 1, 10);

    expect(result).toEqual({ ok: false, reason: 'not_saved' });
    expect(diaryUpdates).toHaveLength(0);
  });

  it('editSaved: refuses without writing when the draft has no diaryId', async () => {
    const { db, diaryUpdates } = makeFakeDb([makeDraftRow({ status: 'confirmed', diaryId: null })]);

    const result = await recomputeSavedEntry(asDb(db), 1, 10);

    expect(result).toEqual({ ok: false, reason: 'not_saved' });
    expect(diaryUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deleteSavedEntry (delete, D-08)
// ---------------------------------------------------------------------------

describe('deleteSavedEntry (delete)', () => {
  function savedDraftAndDiary(overrides: Partial<DraftRow> = {}) {
    const savedDiaryRow: DiaryRow = {
      id: 50,
      userId: 10,
      localDate: '2026-08-15',
      description: 'x',
      kcal: 1,
      proteinG: 1,
      fatG: 1,
      carbsG: 1,
      sugarG: 1,
      draftId: 1,
    };
    return makeFakeDb(
      [makeDraftRow({ status: 'confirmed', diaryId: 50, ...overrides })],
      [savedDiaryRow],
    );
  }

  it('delete: DELETEs the diary row scoped by (id, user_id) and marks the draft abandoned via claimAbandon', async () => {
    const { db, diaryRows, draftRows } = savedDraftAndDiary();

    const result = await deleteSavedEntry(asDb(db), 1, 10, true);

    expect(result).toEqual({ ok: true });
    expect(diaryRows.has(50)).toBe(false);
    expect(draftRows.get(1)?.status).toBe('abandoned');
  });

  it('delete: a second call performs zero additional DELETEs and reports already_deleted', async () => {
    const { db, diaryDeleteWhereColumns } = savedDraftAndDiary();

    const first = await deleteSavedEntry(asDb(db), 1, 10, true);
    const second = await deleteSavedEntry(asDb(db), 1, 10, true);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: 'already_deleted' });
    expect(diaryDeleteWhereColumns).toHaveLength(1);
  });

  it('delete: with confirmed: false records zero DELETEs on the fake Db', async () => {
    const { db, diaryDeleteWhereColumns } = savedDraftAndDiary();

    const result = await deleteSavedEntry(asDb(db), 1, 10, false);

    expect(result).toEqual({ ok: false, reason: 'not_confirmed' });
    expect(diaryDeleteWhereColumns).toHaveLength(0);
  });

  it('delete: for a draft belonging to another user performs no DELETE', async () => {
    const { db, diaryDeleteWhereColumns } = savedDraftAndDiary();

    const result = await deleteSavedEntry(asDb(db), 1, 999, true);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(diaryDeleteWhereColumns).toHaveLength(0);
  });

  it('delete: every diary UPDATE/DELETE is scoped by both diary.id and diary.userId', async () => {
    const { db, diaryDeleteWhereColumns } = savedDraftAndDiary();

    await deleteSavedEntry(asDb(db), 1, 10, true);

    const columns = diaryDeleteWhereColumns[0] ?? [];
    expect(columns).toContain(diary.id);
    expect(columns).toContain(diary.userId);
  });
});
