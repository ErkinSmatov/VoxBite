import { describe, expect, it } from 'vitest';
import type { NutritionTargets } from '../../domain/nutrition/index.js';
import { DISCLAIMER_TEXT, questionCopy, targetsWithDisclaimerMessage } from './onboarding-copy';

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
});
