import { describe, expect, it, vi } from 'vitest';

// Same tagged-condition mocking approach as draft-store.test.ts: real
// eq/and/or return opaque SQL fragments meant for Postgres, not for
// inspection in a unit test -- this mock replaces them with plain, tagged
// objects the fake `db` below can read directly, asserting on column
// *identity* rather than a guessed string key. corrections.ts composes
// draft-store.ts's readDraft/updateDraftComponents/clearAwaitingInput, which
// is what actually calls eq/and/or -- so this file needs the same mock.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq' as const, column, value }),
    and: (...conditions: unknown[]) => ({ kind: 'and' as const, conditions }),
    or: (...conditions: unknown[]) => ({ kind: 'or' as const, conditions }),
  };
});

const {
  swapCandidate,
  adjustGrams,
  applyTypedGrams,
  removeComponent,
  addComponent,
  parseGrams,
  GRAM_STEP,
  MIN_GRAMS,
  MAX_GRAMS,
  MAX_COMPONENT_TEXT_LENGTH,
} = await import('./corrections.js');
const { diaryDrafts } = await import('../db/schema/diary-drafts.js');
import type { DraftComponent } from './types.js';
import type { FdcCandidate, FdcRepository } from '../domain/fdc-matching/index.js';
import type { Embedder } from '../adapters/embeddings/types.js';

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
type Condition = EqCondition | AndCondition | OrCondition;

function matches(condition: Condition, row: FakeRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => matches(c as Condition, row));
  }
  if (condition.kind === 'or') {
    return condition.conditions.some((c) => matches(c as Condition, row));
  }
  if (condition.column === diaryDrafts.id) return row.id === condition.value;
  if (condition.column === diaryDrafts.userId) return row.userId === condition.value;
  if (condition.column === diaryDrafts.status) return row.status === condition.value;
  throw new Error('unexpected eq() column in test');
}

/**
 * Hand-built fake `db` -- copies draft-store.test.ts's structural-stub
 * style. Opens no real database connection.
 */
function makeFakeDb(initialRows: FakeRow[] = []) {
  const rows = new Map(initialRows.map((r) => [r.id, { ...r }]));

  function selectResult(condition: Condition) {
    const filtered = [...rows.values()].filter((row) => matches(condition, row));
    return {
      limit(n: number) {
        return Promise.resolve(filtered.slice(0, n).map(toSelectShape));
      },
    };
  }

  function toSelectShape(row: FakeRow) {
    const { updatedAt: _updatedAt, ...rest } = row;
    return rest;
  }

  function updateResult(condition: Condition, patch: Partial<FakeRow>) {
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

  return { db, rows };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asDb(db: unknown): any {
  return db;
}

function candidate(overrides: Partial<FdcCandidate> = {}): FdcCandidate {
  return {
    fdcId: 1,
    description: 'Sour cream, cultured',
    source: 'sr_legacy_food',
    kcal: 200,
    proteinG: 3,
    fatG: 20,
    carbsG: 4,
    sugarG: 3,
    similarity: 0.9,
    ...overrides,
  };
}

function sampleComponents(): DraftComponent[] {
  return [
    {
      component: 'куриная грудка',
      componentEn: 'chicken breast',
      grams: 150,
      candidates: [candidate({ fdcId: 10 }), candidate({ fdcId: 11 }), candidate({ fdcId: 12 })],
      chosenFdcId: 10,
      weakMatch: false,
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

const NOW = new Date('2026-08-15T01:00:00Z');
const EXPIRED_NOW = new Date('2026-08-16T02:00:00Z'); // > DRAFT_TTL_HOURS past createdAt above

describe('parseGrams', () => {
  it('accepts plain and unit-suffixed forms', () => {
    expect(parseGrams('200')).toBe(200);
    expect(parseGrams('200 г')).toBe(200);
    expect(parseGrams('200г')).toBe(200);
    expect(parseGrams(' 200 Г ')).toBe(200);
  });

  it('rejects zero, negative, non-numeric, empty, exponential and out-of-range text', () => {
    expect(parseGrams('0')).toBeNull();
    expect(parseGrams('-5')).toBeNull();
    expect(parseGrams('abc')).toBeNull();
    expect(parseGrams('')).toBeNull();
    expect(parseGrams('1e9')).toBeNull();
    expect(parseGrams('99999')).toBeNull();
  });

  it('rounds a decimal value by one consistent, pinned rule (Math.round, half up)', () => {
    expect(parseGrams('200.5')).toBe(201);
    expect(parseGrams('200,5')).toBe(201);
  });
});

describe('swapCandidate', () => {
  it('sets chosenFdcId to the selected candidate and recomputes weakMatch, leaving other components untouched', async () => {
    const otherComponent: DraftComponent = {
      component: 'рис',
      componentEn: 'rice',
      grams: 200,
      candidates: [candidate({ fdcId: 20 })],
      chosenFdcId: 20,
      weakMatch: false,
    };
    const { db, rows } = makeFakeDb([
      makeRow({ components: [...sampleComponents(), otherComponent] }),
    ]);

    const result = await swapCandidate(asDb(db), 1, 10, 0, 2, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.components[0]?.chosenFdcId).toBe(12);
      expect(result.components[1]).toEqual(otherComponent);
    }
    expect(rows.get(1)?.components[0]?.chosenFdcId).toBe(12);
  });

  it('leaves the draft unchanged and reports failure for an out-of-range candidate index', async () => {
    const { db, rows } = makeFakeDb([makeRow()]);
    const before = rows.get(1)?.components;

    const result = await swapCandidate(asDb(db), 1, 10, 0, 99, NOW);

    expect(result).toEqual({ ok: false, reason: 'out_of_range' });
    expect(rows.get(1)?.components).toEqual(before);
  });

  it('leaves the draft unchanged and reports failure for an out-of-range component index', async () => {
    const { db, rows } = makeFakeDb([makeRow()]);
    const before = rows.get(1)?.components;

    const result = await swapCandidate(asDb(db), 1, 10, 5, 0, NOW);

    expect(result).toEqual({ ok: false, reason: 'out_of_range' });
    expect(rows.get(1)?.components).toEqual(before);
  });

  it('performs no write and reports failure for a draft belonging to another user', async () => {
    const { db, rows } = makeFakeDb([makeRow({ userId: 10 })]);
    const before = rows.get(1)?.components;

    const result = await swapCandidate(asDb(db), 1, 999, 0, 1, NOW);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(rows.get(1)?.components).toEqual(before);
  });

  it('reports expired for a stale draft', async () => {
    const { db } = makeFakeDb([makeRow()]);

    const result = await swapCandidate(asDb(db), 1, 10, 0, 1, EXPIRED_NOW);

    expect(result).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('adjustGrams', () => {
  it('adds GRAM_STEP to the component grams', async () => {
    const { db } = makeFakeDb([makeRow({ components: [{ ...sampleComponents()[0]!, grams: 120 }] })]);

    const result = await adjustGrams(asDb(db), 1, 10, 0, GRAM_STEP, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.components[0]?.grams).toBe(130);
  });

  it('clamps to MIN_GRAMS and never goes to 0 or negative', async () => {
    const { db } = makeFakeDb([makeRow({ components: [{ ...sampleComponents()[0]!, grams: MIN_GRAMS }] })]);

    const result = await adjustGrams(asDb(db), 1, 10, 0, -GRAM_STEP, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.components[0]?.grams).toBe(MIN_GRAMS);
  });

  it('clamps to MAX_GRAMS at the upper bound', async () => {
    const { db } = makeFakeDb([makeRow({ components: [{ ...sampleComponents()[0]!, grams: MAX_GRAMS }] })]);

    const result = await adjustGrams(asDb(db), 1, 10, 0, GRAM_STEP, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.components[0]?.grams).toBe(MAX_GRAMS);
  });

  it('performs no write and reports failure for a draft belonging to another user', async () => {
    const { db, rows } = makeFakeDb([makeRow({ userId: 10 })]);
    const before = rows.get(1)?.components;

    const result = await adjustGrams(asDb(db), 1, 999, 0, GRAM_STEP, NOW);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(rows.get(1)?.components).toEqual(before);
  });
});

describe('applyTypedGrams', () => {
  it('writes parsed grams and clears the awaiting-input flag on success', async () => {
    const { db, rows } = makeFakeDb([
      makeRow({ awaitingInput: { kind: 'typed_grams', componentIndex: 0 } }),
    ]);

    const result = await applyTypedGrams(asDb(db), 1, 10, 0, '250 г', NOW);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.components[0]?.grams).toBe(250);
    expect(rows.get(1)?.awaitingInput).toBeNull();
  });

  it('leaves grams unchanged and does not clear awaiting-input on unparseable text', async () => {
    const { db, rows } = makeFakeDb([
      makeRow({ awaitingInput: { kind: 'typed_grams', componentIndex: 0 } }),
    ]);
    const before = rows.get(1)?.components[0]?.grams;

    const result = await applyTypedGrams(asDb(db), 1, 10, 0, 'not a number', NOW);

    expect(result).toEqual({ ok: false, reason: 'invalid_grams' });
    expect(rows.get(1)?.components[0]?.grams).toBe(before);
    expect(rows.get(1)?.awaitingInput).toEqual({ kind: 'typed_grams', componentIndex: 0 });
  });
});

describe('removeComponent', () => {
  it('removes exactly the indexed component and preserves order of the rest', async () => {
    const c1 = sampleComponents()[0]!;
    const c2: DraftComponent = { ...c1, component: 'рис', chosenFdcId: 20 };
    const c3: DraftComponent = { ...c1, component: 'соус', chosenFdcId: 30 };
    const { db } = makeFakeDb([makeRow({ components: [c1, c2, c3] })]);

    const result = await removeComponent(asDb(db), 1, 10, 1, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.components.map((c) => c.component)).toEqual(['куриная грудка', 'соус']);
    }
  });

  it('on the last remaining component leaves an empty array, status still draft, without an extra status write', async () => {
    const { db, rows } = makeFakeDb([makeRow({ components: sampleComponents(), status: 'draft' })]);

    const result = await removeComponent(asDb(db), 1, 10, 0, NOW);

    expect(result).toEqual({ ok: true, components: [] });
    expect(rows.get(1)?.components).toEqual([]);
    expect(rows.get(1)?.status).toBe('draft');
  });

  it('reports out_of_range without writing for an invalid index', async () => {
    const { db, rows } = makeFakeDb([makeRow()]);
    const before = rows.get(1)?.components;

    const result = await removeComponent(asDb(db), 1, 10, 7, NOW);

    expect(result).toEqual({ ok: false, reason: 'out_of_range' });
    expect(rows.get(1)?.components).toEqual(before);
  });

  it('performs no write and reports failure for a draft belonging to another user', async () => {
    const { db, rows } = makeFakeDb([makeRow({ userId: 10 })]);
    const before = rows.get(1)?.components;

    const result = await removeComponent(asDb(db), 1, 999, 0, NOW);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(rows.get(1)?.components).toEqual(before);
  });
});

describe('addComponent', () => {
  // matchIngredient (src/domain/fdc-matching) asserts a 1536-dim embedding
  // before ever reaching the (fake) repository -- match the real contract.
  function fakeEmbedder(
    vectors: number[][] = [new Array(1536).fill(0.01)],
  ): { embedder: Embedder; calls: string[][] } {
    const calls: string[][] = [];
    const embedder: Embedder = {
      embed: async (texts: string[]) => {
        calls.push(texts);
        return vectors;
      },
    };
    return { embedder, calls };
  }

  function fakeRepo(candidates: FdcCandidate[] = [candidate({ fdcId: 50, similarity: 0.95 })]): FdcRepository {
    return {
      findNearest: async () => candidates,
    };
  }

  it('parses "сметана 30" into grams 30 and sends componentEn to the embedder', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder, calls } = fakeEmbedder();

    const result = await addComponent(asDb(db), 1, 10, 'сметана 30', { embedder, repo: fakeRepo() }, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const added = result.components[result.components.length - 1]!;
      expect(added.grams).toBe(30);
      expect(added.componentEn).toBe('сметана');
    }
    expect(calls).toEqual([['сметана']]);
  });

  it('defaults grams to 100 for a bare name', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder } = fakeEmbedder();

    const result = await addComponent(asDb(db), 1, 10, 'сметана', { embedder, repo: fakeRepo() }, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const added = result.components[result.components.length - 1]!;
      expect(added.grams).toBe(100);
    }
  });

  it('appends to the end of the components array, leaving existing components byte-identical', async () => {
    const existing = sampleComponents();
    const { db } = makeFakeDb([makeRow({ components: existing })]);
    const { embedder } = fakeEmbedder();

    const result = await addComponent(asDb(db), 1, 10, 'сметана', { embedder, repo: fakeRepo() }, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.components.slice(0, existing.length)).toEqual(existing);
      expect(result.components).toHaveLength(existing.length + 1);
    }
  });

  it('sets candidates/chosenFdcId/weakMatch from matchIngredient\'s return value', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder } = fakeEmbedder();
    const strongCandidate = candidate({ fdcId: 77, similarity: 0.95 });

    const result = await addComponent(
      asDb(db),
      1,
      10,
      'сметана',
      { embedder, repo: fakeRepo([strongCandidate]) },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      const added = result.components[result.components.length - 1]!;
      expect(added.candidates).toEqual([strongCandidate]);
      expect(added.chosenFdcId).toBe(77);
      expect(added.weakMatch).toBe(false);
    }
  });

  it('appends a flagged, never-dropped component when matchIngredient returns no candidates', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder } = fakeEmbedder();

    const result = await addComponent(asDb(db), 1, 10, 'неизвестный ингредиент', { embedder, repo: fakeRepo([]) }, NOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const added = result.components[result.components.length - 1]!;
      expect(added.chosenFdcId).toBeNull();
      expect(added.weakMatch).toBe(true);
    }
  });

  it('refuses text over MAX_COMPONENT_TEXT_LENGTH before calling the embedder', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder, calls } = fakeEmbedder();
    const longText = 'а'.repeat(MAX_COMPONENT_TEXT_LENGTH + 1);

    const result = await addComponent(asDb(db), 1, 10, longText, { embedder, repo: fakeRepo() }, NOW);

    expect(result).toEqual({ ok: false, reason: 'text_too_long' });
    expect(calls).toHaveLength(0);
  });

  it('refuses empty/whitespace-only text before calling the embedder', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder, calls } = fakeEmbedder();

    const result = await addComponent(asDb(db), 1, 10, '   ', { embedder, repo: fakeRepo() }, NOW);

    expect(result).toEqual({ ok: false, reason: 'empty_text' });
    expect(calls).toHaveLength(0);
  });

  it('calls the embedder exactly once per addComponent call', async () => {
    const { db } = makeFakeDb([makeRow()]);
    const { embedder, calls } = fakeEmbedder();

    await addComponent(asDb(db), 1, 10, 'сметана', { embedder, repo: fakeRepo() }, NOW);

    expect(calls).toHaveLength(1);
  });

  it('leaves the draft unmodified and reports match_failed when the embedder rejects', async () => {
    const { db, rows } = makeFakeDb([makeRow()]);
    const before = rows.get(1)?.components;
    const embedder: Embedder = {
      embed: async () => {
        throw new Error('embedding provider down');
      },
    };

    const result = await addComponent(asDb(db), 1, 10, 'сметана', { embedder, repo: fakeRepo() }, NOW);

    expect(result).toEqual({ ok: false, reason: 'match_failed' });
    expect(rows.get(1)?.components).toEqual(before);
  });
});
