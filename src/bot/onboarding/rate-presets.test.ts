import { describe, expect, it } from 'vitest';
import { MAX_RATE_KG_PER_MONTH } from '../../domain/nutrition/constants.js';
import { RATE_PRESETS_KG_PER_MONTH, decodeRate } from './rate-presets.js';

describe('RATE_PRESETS_KG_PER_MONTH', () => {
  it('deep-equals [0.25, 0.5, 0.75, 1]', () => {
    expect(RATE_PRESETS_KG_PER_MONTH).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('its maximum equals MAX_RATE_KG_PER_MONTH — the domain/UI cap regression guard', () => {
    expect(Math.max(...RATE_PRESETS_KG_PER_MONTH)).toBe(MAX_RATE_KG_PER_MONTH);
  });
});

describe('decodeRate', () => {
  it('decodes a valid preset', () => {
    expect(decodeRate('rate:0.5')).toBe(0.5);
  });

  it.each([['rate:2'], ['rate:1.0001'], ['2'], [undefined], [''], ['rate:abc']])(
    'decodeRate(%j) -> undefined',
    (input) => {
      expect(decodeRate(input)).toBeUndefined();
    },
  );
});
