import { describe, expect, it } from 'vitest';
import type { NutritionTargets } from '../../domain/nutrition/index.js';
import {
  CANCEL_KEYWORDS,
  DISCLAIMER_TEXT,
  isCancelKeyword,
  questionCopy,
  targetsWithDisclaimerMessage,
} from './onboarding-copy';

const BASE_TARGETS: NutritionTargets = {
  bmr: 1700,
  tdee: 2635,
  targetKcal: 2378,
  proteinG: 144,
  fatG: 72,
  carbsG: 250,
  floorApplied: false,
  rateKgPerMonth: 0.5,
};

describe('DISCLAIMER_TEXT', () => {
  it('is a non-empty Russian string containing the non-medical-device wording', () => {
    expect(DISCLAIMER_TEXT.length).toBeGreaterThan(0);
    expect(DISCLAIMER_TEXT).toMatch(/не медицинск/);
    expect(DISCLAIMER_TEXT).toMatch(/врач/);
  });
});

describe('targetsWithDisclaimerMessage', () => {
  it('contains DISCLAIMER_TEXT and all four numbers from the targets', () => {
    const msg = targetsWithDisclaimerMessage(BASE_TARGETS);
    expect(msg).toContain(DISCLAIMER_TEXT);
    expect(msg).toContain(String(BASE_TARGETS.targetKcal));
    expect(msg).toContain(String(BASE_TARGETS.proteinG));
    expect(msg).toContain(String(BASE_TARGETS.fatG));
    expect(msg).toContain(String(BASE_TARGETS.carbsG));
  });

  it('positions the disclaimer after the numbers', () => {
    const msg = targetsWithDisclaimerMessage(BASE_TARGETS);
    const kcalIndex = msg.indexOf(String(BASE_TARGETS.targetKcal));
    const disclaimerIndex = msg.indexOf(DISCLAIMER_TEXT);
    expect(disclaimerIndex).toBeGreaterThan(kcalIndex);
  });

  it('states the rate actually used when rateKgPerMonth > 0', () => {
    const msg = targetsWithDisclaimerMessage(BASE_TARGETS);
    expect(msg).toContain('0.5');
  });

  it('does not mention a rate line when rateKgPerMonth is 0 (maintain)', () => {
    const msg = targetsWithDisclaimerMessage({ ...BASE_TARGETS, rateKgPerMonth: 0 });
    // No literal "0 кг/мес" style line should appear.
    expect(msg).not.toMatch(/0 кг\/мес/);
  });

  it('adds an extra explanatory line only when floorApplied is true', () => {
    const withoutFloor = targetsWithDisclaimerMessage({ ...BASE_TARGETS, floorApplied: false });
    const withFloor = targetsWithDisclaimerMessage({ ...BASE_TARGETS, floorApplied: true });
    expect(withoutFloor).not.toMatch(/минимал|безопасн/i);
    expect(withFloor).toMatch(/минимал|безопасн/i);
  });
});

describe('questionCopy', () => {
  it('every entry is non-empty Russian text', () => {
    for (const value of Object.values(questionCopy)) {
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it.each(['age', 'height', 'weight'] as const)('%s question contains a concrete example number', (key) => {
    expect(questionCopy[key]).toMatch(/[0-9]/);
  });

  // CR-03: the hint is useless if it does not name a word the parser accepts.
  it('the cancel hint names at least one keyword that actually cancels', () => {
    const named = CANCEL_KEYWORDS.filter((keyword) => questionCopy.cancelHint.includes(keyword));
    expect(named.length).toBeGreaterThan(0);
  });

  it('the cancelled message says nothing was saved and how to start over', () => {
    expect(questionCopy.cancelled).toMatch(/не сохранено/);
    expect(questionCopy.cancelled).toContain('/start');
  });

  it('the save-failure message says the answers are still there', () => {
    expect(questionCopy.saveFailed).toMatch(/не получилось сохранить/i);
    expect(questionCopy.saveFailed).toContain('Всё верно');
  });
});

describe('isCancelKeyword', () => {
  it.each(CANCEL_KEYWORDS)('accepts «%s»', (keyword) => {
    expect(isCancelKeyword(keyword)).toBe(true);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isCancelKeyword('  ОТМЕНА ')).toBe(true);
    expect(isCancelKeyword('/CANCEL')).toBe(true);
  });

  it.each(['29', '178', '72.5', 'отменить подписку', 'cancel', ''])(
    'rejects «%s», which is not a cancel word',
    (text) => {
      expect(isCancelKeyword(text)).toBe(false);
    },
  );
});
