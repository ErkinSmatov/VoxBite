import { describe, expect, it } from 'vitest';
import type { DraftComponent } from '../../application/types.js';
import type { FdcCandidate } from '../../domain/fdc-matching/index.js';
import { correctionCopy } from '../formatting/correction-copy.js';
import {
  CRC_PATTERN,
  CRC_PREFIX,
  buildConfirmedKeyboard,
  buildDeleteConfirmKeyboard,
  buildEmptyStateKeyboard,
  buildLevel1Keyboard,
  buildLevel2Keyboard,
  encodeCrc,
  parseCrc,
} from './correction-keyboards';

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
    candidate({ fdcId: 2, description: 'Chicken, cooked, roasted', similarity: 0.6 }),
    candidate({ fdcId: 3, description: 'Chicken, meat and skin, raw', similarity: 0.5 }),
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

function flat(kb: ReturnType<typeof buildLevel1Keyboard>) {
  return kb.inline_keyboard.flat();
}

describe('encodeCrc / parseCrc', () => {
  it('encodeCrc({draftId:42, action:"sel", index:2}) produces crc:42:sel:2; parseCrc round-trips it', () => {
    const encoded = encodeCrc({ draftId: 42, action: 'sel', index: 2 });
    expect(encoded).toBe('crc:42:sel:2');
    expect(parseCrc(encoded)).toEqual({ draftId: 42, action: 'sel', index: 2 });
  });

  it('encodeCrc without index omits the trailing segment', () => {
    expect(encodeCrc({ draftId: 1, action: 'confirm' })).toBe('crc:1:confirm');
    expect(parseCrc('crc:1:confirm')).toEqual({ draftId: 1, action: 'confirm' });
  });

  it.each([
    'crc:42',
    'crc:abc:sel',
    'crc:42:sel:x',
    'crc:42:bogus',
    'xxx:42:sel:1',
    'crc:42:sel:1:extra',
    '',
    'x'.repeat(200),
  ])('parseCrc rejects malformed input: %s', (input) => {
    expect(parseCrc(input)).toBeNull();
  });

  it('CRC_PATTERN and CRC_PREFIX are consistent', () => {
    expect(CRC_PREFIX).toBe('crc');
    expect(CRC_PATTERN.test('crc:1:add')).toBe(true);
  });

  it('encodeCrc throws on a non-integer draftId or index', () => {
    expect(() => encodeCrc({ draftId: 1.5, action: 'add' })).toThrow();
    expect(() => encodeCrc({ draftId: 1, action: 'sel', index: -1 })).toThrow();
  });
});

describe('byte budget', () => {
  it('every callback_data string any builder emits is at most 64 UTF-8 bytes, for a large draftId and index', () => {
    const draftId = 2147483647;
    const comp = component();
    const keyboards = [
      buildLevel1Keyboard([comp, comp, comp], draftId),
      buildLevel1Keyboard([], draftId),
      buildLevel2Keyboard(comp, 2, draftId),
      buildConfirmedKeyboard(draftId),
      buildDeleteConfirmKeyboard(draftId),
      buildEmptyStateKeyboard(draftId),
    ];

    for (const kb of keyboards) {
      for (const button of flat(kb)) {
        expect('callback_data' in button).toBe(true);
        const data = 'callback_data' in button ? button.callback_data : '';
        expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('buildLevel1Keyboard', () => {
  it('for 3 components produces 3 component buttons (position, name, rounded grams) plus Добавить and Подтвердить', () => {
    const c1 = component({ component: 'куриная грудка', grams: 150.2 });
    const c2 = component({ component: 'рис', grams: 100 });
    const c3 = component({ component: 'соус', grams: 20 });
    const kb = buildLevel1Keyboard([c1, c2, c3], 5);
    const buttons = flat(kb);

    expect(buttons).toHaveLength(5);
    expect(buttons.some((b) => b.text.includes('1.') && b.text.includes('куриная грудка') && b.text.includes('150'))).toBe(true);
    expect(buttons.some((b) => b.text.includes('2.') && b.text.includes('рис') && b.text.includes('100'))).toBe(true);
    expect(buttons.some((b) => b.text.includes('3.') && b.text.includes('соус') && b.text.includes('20'))).toBe(true);
    expect(buttons.some((b) => b.text === correctionCopy.btnAdd)).toBe(true);
    expect(buttons.some((b) => b.text === correctionCopy.btnConfirm)).toBe(true);
  });

  it('for 0 components produces only Добавить and Отменить разбор — no Подтвердить', () => {
    const kb = buildLevel1Keyboard([], 5);
    const buttons = flat(kb);
    expect(buttons).toHaveLength(2);
    expect(buttons.some((b) => b.text === correctionCopy.btnAdd)).toBe(true);
    expect(buttons.some((b) => b.text === correctionCopy.btnCancelDraft)).toBe(true);
    expect(buttons.some((b) => b.text === correctionCopy.btnConfirm)).toBe(false);
  });

  it('never ends with a trailing empty row', () => {
    for (const kb of [buildLevel1Keyboard([component(), component()], 1), buildLevel1Keyboard([], 1)]) {
      const rows = kb.inline_keyboard;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[rows.length - 1]!.length).toBeGreaterThan(0);
    }
  });
});

describe('buildLevel2Keyboard', () => {
  it('for a component with 3 candidates produces buttons labelled 1, 2, 3 (never the description), ±10 г, Ввести граммы, Убрать, Назад', () => {
    const c = component();
    const kb = buildLevel2Keyboard(c, 0, 1);
    const buttons = flat(kb);
    const texts = buttons.map((b) => b.text);

    expect(texts).toEqual(
      expect.arrayContaining([
        '1',
        '2',
        '3',
        correctionCopy.btnMinus10,
        correctionCopy.btnPlus10,
        correctionCopy.btnTypeGrams,
        correctionCopy.btnRemove,
        correctionCopy.btnBack,
      ]),
    );
    for (const text of texts) {
      expect(text).not.toContain('Chicken');
    }
  });

  it('for a component with 0 candidates omits numbered candidate buttons but still offers Убрать and Назад', () => {
    const c = component({ candidates: [], chosenFdcId: null });
    const kb = buildLevel2Keyboard(c, 0, 1);
    const buttons = flat(kb);
    const texts = buttons.map((b) => b.text);

    expect(texts).not.toContain('1');
    expect(texts).toContain(correctionCopy.btnRemove);
    expect(texts).toContain(correctionCopy.btnBack);
  });

  it('never ends with a trailing empty row', () => {
    const rows = buildLevel2Keyboard(component(), 0, 1).inline_keyboard;
    expect(rows[rows.length - 1]!.length).toBeGreaterThan(0);
  });
});

describe('buildConfirmedKeyboard / buildDeleteConfirmKeyboard', () => {
  it('buildConfirmedKeyboard produces exactly Поправить and Удалить', () => {
    const buttons = flat(buildConfirmedKeyboard(1));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.text)).toEqual([correctionCopy.btnEdit, correctionCopy.btnDelete]);
  });

  it('buildDeleteConfirmKeyboard produces exactly Да, удалить and Нет', () => {
    const buttons = flat(buildDeleteConfirmKeyboard(1));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.text)).toEqual([correctionCopy.btnDeleteYes, correctionCopy.btnDeleteNo]);
  });
});

describe('buildEmptyStateKeyboard', () => {
  it('produces exactly Добавить and Отменить разбор', () => {
    const buttons = flat(buildEmptyStateKeyboard(1));
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.text)).toEqual([correctionCopy.btnAdd, correctionCopy.btnCancelDraft]);
  });
});
