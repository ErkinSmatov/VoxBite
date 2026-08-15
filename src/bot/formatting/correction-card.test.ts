import { describe, expect, it } from 'vitest';
import type { DraftComponent } from '../../application/types.js';
import type { FdcCandidate } from '../../domain/fdc-matching/index.js';
import { calculateTotal } from '../../domain/nutrition/index.js';
import type { TotalInputItem } from '../../domain/nutrition/index.js';
import { correctionCopy } from './correction-copy.js';
import { buildComponentEditCard, buildConfirmedCard, buildCorrectionCard, formatTotalsBlock } from './correction-card';

function candidate(overrides: Partial<FdcCandidate> = {}): FdcCandidate {
  return {
    fdcId: 1,
    description: 'Chicken, broilers or fryers, breast, meat only, raw',
    source: 'foundation_food',
    kcal: 120,
    proteinG: 22,
    fatG: 3,
    carbsG: 0,
    sugarG: null,
    similarity: 0.85,
    ...overrides,
  };
}

function component(overrides: Partial<DraftComponent> = {}): DraftComponent {
  const candidates = [
    candidate(),
    candidate({ fdcId: 2, description: 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', similarity: 0.6 }),
    candidate({ fdcId: 3, description: 'Chicken, broilers or fryers, breast, meat and skin, raw', similarity: 0.5 }),
  ];
  return {
    component: 'куриная грудка',
    componentEn: 'chicken breast',
    grams: 150,
    candidates,
    chosenFdcId: candidates[0]!.fdcId,
    weakMatch: false,
    ...overrides,
  };
}

function toItem(c: DraftComponent): TotalInputItem | null {
  if (c.chosenFdcId === null) return null;
  const chosen = c.candidates.find((cand) => cand.fdcId === c.chosenFdcId);
  if (!chosen) return null;
  return {
    grams: c.grams,
    kcal: chosen.kcal,
    proteinG: chosen.proteinG,
    fatG: chosen.fatG,
    carbsG: chosen.carbsG,
    sugarG: chosen.sugarG,
  };
}

describe('formatTotalsBlock / buildCorrectionCard (level 1)', () => {
  it('lists each component name, rounded grams, chosen candidate description verbatim, plus one ≈ preview line with the not-saved marker', () => {
    const c1 = component({ component: 'куриная грудка', grams: 150.4 });
    const c2 = component({
      component: 'рис',
      grams: 100,
      candidates: [candidate({ fdcId: 10, description: 'Rice, white, long-grain, raw', kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28, sugarG: 0.1 })],
      chosenFdcId: 10,
    });
    const card = buildCorrectionCard([c1, c2]);

    expect(card).toContain('куриная грудка');
    expect(card).toContain('150 г');
    expect(card).toContain('Chicken, broilers or fryers, breast, meat only, raw');
    expect(card).toContain('рис');
    expect(card).toContain('100 г');
    expect(card).toContain('Rice, white, long-grain, raw');
    expect(card).toContain(correctionCopy.previewPrefix);
    expect(card).toContain(correctionCopy.notSavedMarker);
  });

  it('preview numbers equal calculateTotal(...) rounded to integers for the same component set', () => {
    const c1 = component({ grams: 150 });
    const c2 = component({
      component: 'рис',
      grams: 100,
      candidates: [candidate({ fdcId: 10, description: 'Rice, white, long-grain, raw', kcal: 130, proteinG: 2.7, fatG: 0.3, carbsG: 28, sugarG: 0.1 })],
      chosenFdcId: 10,
    });
    const items = [c1, c2].map(toItem).filter((x): x is TotalInputItem => x !== null);
    const expected = calculateTotal(items);

    const card = buildCorrectionCard([c1, c2]);

    expect(card).toContain(String(Math.round(expected.kcal!)));
    expect(card).toContain(String(Math.round(expected.proteinG!)));
    expect(card).toContain(String(Math.round(expected.fatG!)));
    expect(card).toContain(String(Math.round(expected.carbsG!)));
  });

  it('one of three components with sugarG null renders the partial lower-bound shape, not a plain sum and not 0', () => {
    const c1 = component({ candidates: [candidate({ sugarG: 2 })], chosenFdcId: 1 });
    const c2 = component({ candidates: [candidate({ fdcId: 2, sugarG: null })], chosenFdcId: 2 });
    const c3 = component({ candidates: [candidate({ fdcId: 3, sugarG: 4 })], chosenFdcId: 3 });

    const card = buildCorrectionCard([c1, c2, c3]);

    expect(card).toContain('у 1 из 3 нет данных');
  });

  it('all three components with sugarG null renders noData for sugar with no number on that line', () => {
    const c1 = component({ candidates: [candidate({ sugarG: null })], chosenFdcId: 1 });
    const c2 = component({ candidates: [candidate({ fdcId: 2, sugarG: null })], chosenFdcId: 2 });
    const c3 = component({ candidates: [candidate({ fdcId: 3, sugarG: null })], chosenFdcId: 3 });

    const card = buildCorrectionCard([c1, c2, c3]);
    const sugarLine = card.split('\n').find((line) => line.startsWith('Сахар'));

    expect(card).toContain(correctionCopy.noData);
    expect(sugarLine).toBeDefined();
    expect(sugarLine).not.toContain('0 г');
  });

  it('a component whose chosenFdcId is null renders correctionCopy.noMatch and does not throw', () => {
    const c1 = component({ candidates: [], chosenFdcId: null });
    expect(() => buildCorrectionCard([c1])).not.toThrow();
    expect(buildCorrectionCard([c1])).toContain(correctionCopy.noMatch);
  });

  it('a component with weakMatch true still renders the existing weak-match line', () => {
    const c1 = component({ weakMatch: true });
    expect(buildCorrectionCard([c1])).toContain('⚠️ совпадение слабое, проверь');
  });

  it('empty component list renders correctionCopy.emptyState and no preview line', () => {
    const card = buildCorrectionCard([]);
    expect(card).toBe(correctionCopy.emptyState);
    expect(card).not.toContain(correctionCopy.previewPrefix);
  });
});

describe('buildComponentEditCard (level 2)', () => {
  it('renders the component name, grams, and all three candidate descriptions verbatim as numbered lines, chosenMarker only on the chosen one', () => {
    const c1 = component();
    const card = buildComponentEditCard([c1], 0);

    expect(card).toContain('куриная грудка');
    expect(card).toContain('150 г');
    expect(card).toContain('1. Chicken, broilers or fryers, breast, meat only, raw');
    expect(card).toContain('2. Chicken, broilers or fryers, breast, meat only, cooked, roasted');
    expect(card).toContain('3. Chicken, broilers or fryers, breast, meat and skin, raw');

    const chosenLine = card.split('\n').find((line) => line.startsWith('1. '));
    const otherLine = card.split('\n').find((line) => line.startsWith('2. '));
    expect(chosenLine).toContain(correctionCopy.chosenMarker);
    expect(otherLine).not.toContain(correctionCopy.chosenMarker);
  });

  it('a component with zero candidates renders correctionCopy.noMatch and no numbered lines', () => {
    const c1 = component({ candidates: [], chosenFdcId: null });
    const card = buildComponentEditCard([c1], 0);

    expect(card).toContain(correctionCopy.noMatch);
    expect(card).not.toMatch(/^1\. /m);
  });

  it('throws a descriptive error for an out-of-range index', () => {
    const c1 = component();
    expect(() => buildComponentEditCard([c1], 5)).toThrow(/index/i);
  });
});

describe('buildConfirmedCard', () => {
  it('renders final numbers with NO ≈, no not-saved marker, and the savedOn line', () => {
    const c1 = component({ grams: 150 });
    const card = buildConfirmedCard([c1], '2026-08-15');

    expect(card).not.toContain(correctionCopy.previewPrefix);
    expect(card).not.toContain(correctionCopy.notSavedMarker);
    expect(card).toContain(correctionCopy.savedOn('2026-08-15'));
  });
});
