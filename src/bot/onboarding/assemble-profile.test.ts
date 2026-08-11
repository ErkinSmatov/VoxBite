import { describe, expect, it } from 'vitest';
import { calculateNutritionTargets } from '../../domain/nutrition/index.js';
import { assembleProfile } from './assemble-profile';
import type { OnboardingAnswers } from './assemble-profile';

const BASE_ANSWERS: OnboardingAnswers = {
  sex: 'male',
  ageYears: 29,
  heightCm: 178,
  weightKg: 80,
  activityLevel: 'medium',
  goal: 'loss',
  desiredRateKgPerMonth: 0.5,
  timezone: 'Asia/Almaty',
};

describe('assembleProfile', () => {
  it('produces a profile calculateNutritionTargets accepts, with a positive targetKcal', () => {
    const profile = assembleProfile(BASE_ANSWERS);
    const targets = calculateNutritionTargets(profile);
    expect(targets.targetKcal).toBeGreaterThan(0);
  });

  it('does not include a timezone property on the returned profile', () => {
    const profile = assembleProfile(BASE_ANSWERS);
    expect(Object.keys(profile)).not.toContain('timezone');
  });

  it('omits desiredRateKgPerMonth when goal is maintain', () => {
    const profile = assembleProfile({ ...BASE_ANSWERS, goal: 'maintain', desiredRateKgPerMonth: 0.5 });
    expect(Object.keys(profile)).not.toContain('desiredRateKgPerMonth');
  });

  it('includes desiredRateKgPerMonth when goal is loss', () => {
    const profile = assembleProfile({ ...BASE_ANSWERS, goal: 'loss', desiredRateKgPerMonth: 0.5 });
    expect(profile.desiredRateKgPerMonth).toBe(0.5);
  });

  it('includes desiredRateKgPerMonth when goal is gain', () => {
    const profile = assembleProfile({ ...BASE_ANSWERS, goal: 'gain', desiredRateKgPerMonth: 0.25 });
    expect(profile.desiredRateKgPerMonth).toBe(0.25);
  });

  it('carries over sex, ageYears, heightCm, weightKg, activityLevel, goal exactly', () => {
    const profile = assembleProfile(BASE_ANSWERS);
    expect(profile.sex).toBe(BASE_ANSWERS.sex);
    expect(profile.ageYears).toBe(BASE_ANSWERS.ageYears);
    expect(profile.heightCm).toBe(BASE_ANSWERS.heightCm);
    expect(profile.weightKg).toBe(BASE_ANSWERS.weightKg);
    expect(profile.activityLevel).toBe(BASE_ANSWERS.activityLevel);
    expect(profile.goal).toBe(BASE_ANSWERS.goal);
  });
});
