import { describe, expect, it } from 'vitest';
import type { DraftComponent } from '../../application/types.js';
import type { FdcCandidate } from '../../domain/fdc-matching/index.js';
import { correctionCopy } from '../formatting/correction-copy.js';
import { CRC_PATTERN, parseCrc } from '../keyboards/correction-keyboards.js';
import { createDraftCardRenderer } from './draft-card-renderer.js';

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
  const candidates = [candidate()];
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

interface InlineKeyboardLike {
  inline_keyboard: { text: string; callback_data: string }[][];
}

function buttons(replyMarkup: unknown): { text: string; callback_data: string }[] {
  return (replyMarkup as InlineKeyboardLike).inline_keyboard.flat();
}

describe('createDraftCardRenderer().renderLevel1', () => {
  it('with 2 components returns text containing correctionCopy.headerLevel1 and both component names', () => {
    const renderer = createDraftCardRenderer();
    const components = [
      component({ component: 'куриная грудка' }),
      component({ component: 'рис', componentEn: 'rice' }),
    ];

    const card = renderer.renderLevel1(components, 42);

    expect(card.text).toContain(correctionCopy.headerLevel1);
    expect(card.text).toContain('куриная грудка');
    expect(card.text).toContain('рис');
  });

  it('every callback_data in the returned replyMarkup inline_keyboard matches CRC_PATTERN', () => {
    const renderer = createDraftCardRenderer();
    const components = [component(), component({ component: 'рис' })];

    const card = renderer.renderLevel1(components, 7);

    for (const btn of buttons(card.replyMarkup)) {
      expect(CRC_PATTERN.test(btn.callback_data)).toBe(true);
    }
  });

  it('every parsed callback carries draftId equal to the draftId passed in', () => {
    const renderer = createDraftCardRenderer();
    const components = [component(), component({ component: 'рис' })];
    const draftId = 99;

    const card = renderer.renderLevel1(components, draftId);

    for (const btn of buttons(card.replyMarkup)) {
      const parsed = parseCrc(btn.callback_data);
      expect(parsed?.draftId).toBe(draftId);
    }
  });

  it('the keyboard contains a confirm action and an add action for a non-empty component list', () => {
    const renderer = createDraftCardRenderer();
    const components = [component()];

    const card = renderer.renderLevel1(components, 1);

    const actions = buttons(card.replyMarkup).map((b) => parseCrc(b.callback_data)?.action);
    expect(actions).toContain('confirm');
    expect(actions).toContain('add');
  });

  it('with an EMPTY component list returns correctionCopy.emptyState as text and a keyboard with add + cancel and NO confirm (D-12, Phase 4)', () => {
    const renderer = createDraftCardRenderer();

    const card = renderer.renderLevel1([], 5);

    expect(card.text).toBe(correctionCopy.emptyState);
    const actions = buttons(card.replyMarkup).map((b) => parseCrc(b.callback_data)?.action);
    expect(actions).toContain('add');
    expect(actions).toContain('cancel');
    expect(actions).not.toContain('confirm');
  });
});
