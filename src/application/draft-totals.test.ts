import { describe, expect, it } from 'vitest';
import { summarizeDraft, toPreviewTotalItems } from './draft-totals.js';
import type { DraftComponent } from './types.js';
import type { FdcCandidate } from '../domain/fdc-matching/index.js';

function makeCandidate(overrides: Partial<FdcCandidate> = {}): FdcCandidate {
  return {
    fdcId: 1,
    description: 'Chicken breast, raw',
    source: 'foundation_food',
    similarity: 0.9,
    kcal: 120,
    proteinG: 22,
    fatG: 3,
    carbsG: 0,
    sugarG: 0,
    ...overrides,
  };
}

function makeComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  const candidate = makeCandidate();
  return {
    component: 'куриная грудка',
    componentEn: 'chicken breast',
    grams: 100,
    candidates: [candidate],
    chosenFdcId: candidate.fdcId,
    weakMatch: false,
    ...overrides,
  };
}

describe('toPreviewTotalItems', () => {
  it('returns [] for an empty component list', () => {
    expect(toPreviewTotalItems([])).toEqual([]);
  });

  it('skips a component with chosenFdcId === null', () => {
    const component = makeComponent({ chosenFdcId: null });
    expect(toPreviewTotalItems([component])).toEqual([]);
  });

  it('skips a component whose chosenFdcId is not present in its own candidates array', () => {
    const component = makeComponent({ chosenFdcId: 999 });
    expect(toPreviewTotalItems([component])).toEqual([]);
  });

  it('contributes exactly one item carrying grams and the chosen candidate values verbatim, nulls included', () => {
    const candidate = makeCandidate({ fdcId: 5, kcal: 200, proteinG: null, fatG: 10, carbsG: 5, sugarG: null });
    const component = makeComponent({ grams: 150, candidates: [candidate], chosenFdcId: 5 });

    expect(toPreviewTotalItems([component])).toEqual([
      { grams: 150, kcal: 200, proteinG: null, fatG: 10, carbsG: 5, sugarG: null },
    ]);
  });
});

describe('summarizeDraft', () => {
  it('returns total === calculateTotal(toPreviewTotalItems(components)) and matching contributingCount', () => {
    const component = makeComponent();
    const { total, contributingCount } = summarizeDraft([component]);

    expect(contributingCount).toBe(1);
    expect(total.kcal).toBe(120);
    expect(total.proteinG).toBe(22);
    expect(total.fatG).toBe(3);
    expect(total.carbsG).toBe(0);
    expect(total.sugarG).toBe(0);
  });

  it('never coalesces an all-null-sugar total to 0 (CALC-02)', () => {
    const candidate = makeCandidate({ sugarG: null });
    const component = makeComponent({ candidates: [candidate], chosenFdcId: candidate.fdcId });

    const { total, contributingCount } = summarizeDraft([component]);

    expect(total.sugarG).toBeNull();
    expect(total.missingCount.sugarG).toBe(contributingCount);
  });

  it('returns a total whose every nutrient value is null and contributingCount === 0 for an empty draft', () => {
    const { total, contributingCount } = summarizeDraft([]);

    expect(contributingCount).toBe(0);
    expect(total.kcal).toBeNull();
    expect(total.proteinG).toBeNull();
    expect(total.fatG).toBeNull();
    expect(total.carbsG).toBeNull();
    expect(total.sugarG).toBeNull();
  });
});
