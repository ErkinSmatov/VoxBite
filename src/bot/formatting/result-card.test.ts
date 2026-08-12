import { describe, expect, it } from 'vitest';
import type { DraftComponent, MealDraft } from '../../application/types.js';
import type { FdcCandidate } from '../../domain/fdc-matching/index.js';
import { pipelineCopy } from './pipeline-copy';
import { buildResultCard } from './result-card';

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

function strongComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
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

function weakComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  const candidates = [candidate({ fdcId: 10, description: 'Rice, white, long-grain, raw', similarity: 0.4 })];
  return {
    component: 'рис',
    componentEn: 'rice',
    grams: 100,
    candidates,
    chosenFdcId: candidates[0]!.fdcId,
    weakMatch: true,
    ...overrides,
  };
}

function noCandidatesComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  return {
    component: 'загадочный соус',
    componentEn: 'mystery sauce',
    grams: 20,
    candidates: [],
    chosenFdcId: null,
    weakMatch: true,
    ...overrides,
  };
}

function draft(components: DraftComponent[]): MealDraft {
  return { transcript: 'куриная грудка 150 грамм и рис 100 грамм', source: 'voice', components };
}

describe('buildResultCard', () => {
  it('renders both component names, grams and matched FDC descriptions verbatim for two components', () => {
    const card = buildResultCard(draft([strongComponent(), weakComponent()]));
    expect(card).toContain('куриная грудка');
    expect(card).toContain('150');
    expect(card).toContain('Chicken, broilers or fryers, breast, meat only, raw');
    expect(card).toContain('рис');
    expect(card).toContain('100');
    expect(card).toContain('Rice, white, long-grain, raw');
  });

  it('never contains nutrient words (D-20)', () => {
    const card = buildResultCard(draft([strongComponent(), weakComponent()]));
    for (const word of ['ккал', 'кКал', 'белк', 'жир', 'углевод', 'сахар']) {
      expect(card).not.toContain(word);
    }
  });

  it('flags a weak-match component with the marker text and still renders its name and grams', () => {
    const card = buildResultCard(draft([weakComponent()]));
    expect(card).toContain('совпадение слабое');
    expect(card).toContain('рис');
    expect(card).toContain('100');
  });

  it('renders a component with no candidates at all, never dropping it (D-21)', () => {
    const card = buildResultCard(draft([noCandidatesComponent()]));
    expect(card).toContain('загадочный соус');
    expect(card).toContain('совпадение слабое');
    expect(card).toMatch(/не нашёл подходящую запись/);
  });

  it('never renders the second or third candidate description (D-18)', () => {
    const card = buildResultCard(draft([strongComponent()]));
    expect(card).not.toContain('Chicken, broilers or fryers, breast, meat only, cooked, roasted');
    expect(card).not.toContain('Chicken, broilers or fryers, breast, meat and skin, raw');
  });

  it('never renders a similarity score', () => {
    const card = buildResultCard(draft([strongComponent()]));
    expect(card).not.toMatch(/0\.85/);
  });

  it('states the result is not saved yet and confirmation comes next', () => {
    const card = buildResultCard(draft([strongComponent()]));
    expect(card).toMatch(/не сохранен|подтвер/i);
  });
});

describe('pipelineCopy', () => {
  it('ack equals the single acknowledgement string', () => {
    expect(pipelineCopy.ack).toBe('Секунду, разбираю 🎧');
  });

  it.each([
    'noFood',
    'sttFailed',
    'decompositionFailed',
    'internalError',
    'tooLong',
    'dailyCapReached',
    'unsupportedMessage',
    'interruptedByRestart',
    'notOnboarded',
  ] as const)('%s is a non-empty Russian string', (key) => {
    expect(pipelineCopy[key].length).toBeGreaterThan(0);
  });

  it('tooLong mentions the 60 second limit', () => {
    expect(pipelineCopy.tooLong).toContain('60');
  });

  it('noFood does not read like an error', () => {
    expect(pipelineCopy.noFood).not.toMatch(/ошибка|error/i);
  });

  it('dailyCapReached frames the limit as a safety guard, not a tariff', () => {
    expect(pipelineCopy.dailyCapReached).toMatch(/лимит|ограничен/i);
  });
});
