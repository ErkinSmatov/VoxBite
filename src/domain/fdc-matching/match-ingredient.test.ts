import { describe, expect, it, vi } from 'vitest';
import { matchIngredient } from './match-ingredient';
import { CANDIDATE_COUNT } from './types';
import type { FdcCandidate, FdcRepository } from './types';

function makeEmbedding(length = 1536, fill = 0.1): number[] {
  return new Array(length).fill(fill);
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

/** Hand-written fake repository — records the `limit` it was called with. */
function fakeRepo(rows: FdcCandidate[]): FdcRepository & { calledWithLimit: number[] } {
  const calledWithLimit: number[] = [];
  return {
    calledWithLimit,
    async findNearest(_embedding: number[], limit: number): Promise<FdcCandidate[]> {
      calledWithLimit.push(limit);
      return rows;
    },
  };
}

describe('matchIngredient', () => {
  it('returns exactly 3 candidates when the repository returns 5', async () => {
    const rows = [0.5, 0.9, 0.7, 0.6, 0.8].map((similarity, i) =>
      candidate({ fdcId: i + 1, similarity }),
    );
    const repo = fakeRepo(rows);

    const result = await matchIngredient({ embedding: makeEmbedding(), repo });

    expect(result).toHaveLength(3);
  });

  it('returns fewer than 3 without throwing when the repository returns 2', async () => {
    const rows = [candidate({ fdcId: 1, similarity: 0.5 }), candidate({ fdcId: 2, similarity: 0.6 })];
    const repo = fakeRepo(rows);

    const result = await matchIngredient({ embedding: makeEmbedding(), repo });

    expect(result).toHaveLength(2);
  });

  it('returns [] when the repository returns 0 candidates', async () => {
    const repo = fakeRepo([]);

    const result = await matchIngredient({ embedding: makeEmbedding(), repo });

    expect(result).toEqual([]);
  });

  it('orders results by descending similarity even if the repository returns them unordered', async () => {
    const rows = [
      candidate({ fdcId: 1, similarity: 0.3 }),
      candidate({ fdcId: 2, similarity: 0.95 }),
      candidate({ fdcId: 3, similarity: 0.6 }),
    ];
    const repo = fakeRepo(rows);

    const result = await matchIngredient({ embedding: makeEmbedding(), repo });

    expect(result.map((c) => c.fdcId)).toEqual([2, 3, 1]);
  });

  it('filters out a disallowed source and lets the next allowed candidate take its place', async () => {
    const rows = [
      candidate({ fdcId: 1, source: 'foundation_food', similarity: 0.95 }),
      // @ts-expect-error deliberately injecting a disallowed source to prove the filter
      candidate({ fdcId: 2, source: 'branded_food', similarity: 0.9 }),
      candidate({ fdcId: 3, source: 'sr_legacy_food', similarity: 0.8 }),
      candidate({ fdcId: 4, source: 'sr_legacy_food', similarity: 0.7 }),
    ];
    const repo = fakeRepo(rows);

    const result = await matchIngredient({ embedding: makeEmbedding(), repo });

    expect(result).toHaveLength(3);
    expect(result.map((c) => c.fdcId)).toEqual([1, 3, 4]);
    expect(result.map((c) => c.fdcId)).not.toContain(2);
  });

  it('throws naming expected and actual lengths for a 1535-length embedding, without calling the repository', async () => {
    const repo = fakeRepo([candidate()]);
    const findNearestSpy = vi.spyOn(repo, 'findNearest');

    await expect(matchIngredient({ embedding: makeEmbedding(1535), repo })).rejects.toThrow(
      /expected 1536.*got 1535/i,
    );
    expect(findNearestSpy).not.toHaveBeenCalled();
  });

  it('honours a supplied topN and defaults to CANDIDATE_COUNT', async () => {
    const rows = [0.5, 0.9, 0.7, 0.6, 0.8].map((similarity, i) =>
      candidate({ fdcId: i + 1, similarity }),
    );
    const repo = fakeRepo(rows);

    const defaultResult = await matchIngredient({ embedding: makeEmbedding(), repo });
    expect(defaultResult).toHaveLength(CANDIDATE_COUNT);

    const repo2 = fakeRepo(rows);
    const customResult = await matchIngredient({ embedding: makeEmbedding(), repo: repo2, topN: 2 });
    expect(customResult).toHaveLength(2);
  });

  it('passes sugarG: null through untouched, never substituting 0', async () => {
    const rows = [candidate({ fdcId: 1, sugarG: null, similarity: 0.9 })];
    const repo = fakeRepo(rows);

    const result = await matchIngredient({ embedding: makeEmbedding(), repo });

    expect(result[0]?.sugarG).toBeNull();
  });
});
