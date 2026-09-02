import { describe, expect, it } from 'vitest';
import { ACTIVITY_MULTIPLIERS } from '../../domain/nutrition/constants.js';
import {
  ACTIVITY_OPTIONS,
  DEFAULT_TIMEZONE,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  TIMEZONE_OPTIONS,
  decodeOption,
} from './options.js';

describe('SEX_OPTIONS', () => {
  it('has exactly 2 entries with values male, female', () => {
    expect(SEX_OPTIONS.map((o) => o.value).sort()).toEqual(['female', 'male']);
  });

  it('every label is non-empty Russian text', () => {
    for (const o of SEX_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(0);
    }
  });
});

describe('ACTIVITY_OPTIONS', () => {
  it('values equal exactly the keys of ACTIVITY_MULTIPLIERS', () => {
    expect(ACTIVITY_OPTIONS.map((o) => o.value).sort()).toEqual(Object.keys(ACTIVITY_MULTIPLIERS).sort());
  });

  it('every label describes the level in everyday terms (longer than the raw key)', () => {
    for (const o of ACTIVITY_OPTIONS) {
      expect(o.label.length).toBeGreaterThan(o.value.length);
    }
  });
});

describe('GOAL_OPTIONS', () => {
  it('has exactly 3 entries with values gain, loss, maintain', () => {
    expect(GOAL_OPTIONS.map((o) => o.value).sort()).toEqual(['gain', 'loss', 'maintain']);
  });
});

describe('TIMEZONE_OPTIONS', () => {
  it('every value is a valid IANA zone accepted by Intl.DateTimeFormat', () => {
    for (const o of TIMEZONE_OPTIONS) {
      expect(() => new Intl.DateTimeFormat('ru', { timeZone: o.value })).not.toThrow();
    }
  });

  it('includes Asia/Almaty', () => {
    expect(TIMEZONE_OPTIONS.map((o) => o.value)).toContain('Asia/Almaty');
  });

  it('DEFAULT_TIMEZONE is Asia/Almaty and is one of the options', () => {
    expect(DEFAULT_TIMEZONE).toBe('Asia/Almaty');
    expect(TIMEZONE_OPTIONS.map((o) => o.value)).toContain(DEFAULT_TIMEZONE);
  });
});

describe('callbackData shape', () => {
  const allLists = [
    { name: 'sex', list: SEX_OPTIONS, prefix: 'sex:' },
    { name: 'activity', list: ACTIVITY_OPTIONS, prefix: 'activity:' },
    { name: 'goal', list: GOAL_OPTIONS, prefix: 'goal:' },
    { name: 'tz', list: TIMEZONE_OPTIONS, prefix: 'tz:' },
  ];

  it.each(allLists)('$name: every callbackData is unique, <=64 bytes, and prefixed', ({ list, prefix }) => {
    const seen = new Set<string>();
    for (const o of list) {
      expect(o.callbackData.startsWith(prefix)).toBe(true);
      expect(Buffer.byteLength(o.callbackData, 'utf8')).toBeLessThanOrEqual(64);
      expect(seen.has(o.callbackData)).toBe(false);
      seen.add(o.callbackData);
    }
  });
});

describe('decodeOption', () => {
  it('decodes a valid callback_data to its value', () => {
    expect(decodeOption(SEX_OPTIONS, 'sex:male')).toBe('male');
  });

  it('returns undefined for a forged value not in the list', () => {
    expect(decodeOption(SEX_OPTIONS, 'sex:other')).toBeUndefined();
  });

  it('returns undefined for a value belonging to a different list', () => {
    expect(decodeOption(SEX_OPTIONS, 'goal:loss')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(decodeOption(SEX_OPTIONS, undefined)).toBeUndefined();
  });

  it('returns undefined for empty string input', () => {
    expect(decodeOption(SEX_OPTIONS, '')).toBeUndefined();
  });
});
