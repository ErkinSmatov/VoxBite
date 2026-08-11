import { describe, expect, it } from 'vitest';
import { isIndexable, upsertFdcFoods, type IndexableRecord } from './load.js';
import { fdcFoods, type NewFdcFood } from '../../src/db/schema/fdc-foods.js';

function record(overrides: Partial<IndexableRecord> = {}): IndexableRecord {
  return {
    fdcId: 1,
    description: 'Chicken breast, raw',
    source: 'foundation_food',
    kcal: 120,
    proteinG: 22,
    fatG: 3,
    carbsG: 0,
    sugarG: null,
    ...overrides,
  };
}

describe('isIndexable', () => {
  it('is false when protein, fat and carbs are all null', () => {
    expect(isIndexable(record({ proteinG: null, fatG: null, carbsG: null }))).toBe(false);
  });

  it('is true when only carbsG is present', () => {
    expect(isIndexable(record({ proteinG: null, fatG: null, carbsG: 5 }))).toBe(true);
  });

  it('is true even when kcal and sugarG are both null, as long as one macro is present', () => {
    expect(isIndexable(record({ kcal: null, sugarG: null, proteinG: 10, fatG: null, carbsG: null }))).toBe(true);
  });

  it('treats a macro value of 0 as present, not absent', () => {
    expect(isIndexable(record({ proteinG: 0, fatG: null, carbsG: null }))).toBe(true);
  });

  it('is false when description is empty or whitespace', () => {
    expect(isIndexable(record({ description: '' }))).toBe(false);
    expect(isIndexable(record({ description: '   ' }))).toBe(false);
  });

  it('is true for a normal fully-populated record', () => {
    expect(isIndexable(record())).toBe(true);
  });
});

describe('upsertFdcFoods', () => {
  function makeFakeDb() {
    const calls: NewFdcFood[][] = [];
    const db = {
      insert() {
        return {
          values(rows: NewFdcFood[]) {
            calls.push(rows);
            return {
              onConflictDoUpdate() {
                return Promise.resolve();
              },
            };
          },
        };
      },
    };
    return { db, calls };
  }

  function makeRow(fdcId: number): NewFdcFood {
    return {
      fdcId,
      description: `food ${fdcId}`,
      source: 'foundation_food',
      kcal: 100,
      proteinG: 1,
      fatG: 1,
      carbsG: 1,
      sugarG: null,
      embedding: new Array(1536).fill(0),
      datasetVersion: '2026-04-30',
      embeddingModelVersion: 'text-embedding-3-small',
    };
  }

  it('splits 1200 rows into 3 insert statements at the default chunk size (500)', async () => {
    const { db, calls } = makeFakeDb();
    const rows = new Array(1200).fill(0).map((_, i) => makeRow(i + 1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = await upsertFdcFoods(db as any, rows);

    expect(calls.length).toBe(3);
    expect(calls[0]?.length).toBe(500);
    expect(calls[1]?.length).toBe(500);
    expect(calls[2]?.length).toBe(200);
    expect(total).toBe(1200);
  });

  it('respects a custom chunkSize', async () => {
    const { db, calls } = makeFakeDb();
    const rows = new Array(10).fill(0).map((_, i) => makeRow(i + 1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await upsertFdcFoods(db as any, rows, 4);

    expect(calls.length).toBe(3);
    expect(calls[0]?.length).toBe(4);
    expect(calls[1]?.length).toBe(4);
    expect(calls[2]?.length).toBe(2);
  });

  it('makes zero calls for an empty rows array', async () => {
    const { db, calls } = makeFakeDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = await upsertFdcFoods(db as any, []);
    expect(calls.length).toBe(0);
    expect(total).toBe(0);
  });
});

// fdcFoods import exercised indirectly to confirm the schema module resolves cleanly.
void fdcFoods;
