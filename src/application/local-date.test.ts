import { describe, expect, it } from 'vitest';
import { deriveLocalDate } from './local-date.js';

describe('deriveLocalDate', () => {
  it('a 23:50 Asia/Almaty instant (still UTC-morning) resolves to the local next day (D-07)', () => {
    expect(deriveLocalDate(new Date('2026-08-13T23:50:00Z'), 'Asia/Almaty')).toBe('2026-08-14');
  });

  it('a 00:05 UTC instant just after local midnight resolves to the new local day', () => {
    expect(deriveLocalDate(new Date('2026-08-14T00:05:00Z'), 'Asia/Almaty')).toBe('2026-08-14');
  });

  it('a UTC instant with the UTC timezone round-trips to that instant own YYYY-MM-DD', () => {
    expect(deriveLocalDate(new Date('2026-08-14T12:00:00Z'), 'UTC')).toBe('2026-08-14');
  });

  it.each([
    ['Asia/Almaty', new Date('2026-01-05T10:00:00Z')],
    ['America/New_York', new Date('2026-01-05T10:00:00Z')],
    ['Europe/London', new Date('2026-01-05T10:00:00Z')],
  ])('returns a zero-padded YYYY-MM-DD string for %s', (timezone, instant) => {
    expect(deriveLocalDate(instant, timezone)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('throws a descriptive Error on an unknown/garbage timezone rather than falling back to the process timezone', () => {
    expect(() => deriveLocalDate(new Date('2026-08-14T00:00:00Z'), 'Not/AZone')).toThrow(/Not\/AZone/);
  });

  it('throws a descriptive Error on an invalid Date', () => {
    expect(() => deriveLocalDate(new Date('not-a-date'), 'Asia/Almaty')).toThrow();
  });
});
