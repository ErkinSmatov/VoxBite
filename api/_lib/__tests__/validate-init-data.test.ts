import { sign } from '@tma.js/init-data-node';
import { describe, expect, it } from 'vitest';
import { MAX_AUTH_AGE_SECONDS, validateAndParse } from '../validate-init-data';

const BOT_TOKEN = 'fake-test-bot-token:ABC123';

function signedInitData(authDate: Date, userId = 42): string {
  return sign({ user: { id: userId, first_name: 'Test' } }, BOT_TOKEN, authDate);
}

describe('validateAndParse', () => {
  it('returns a parsed object exposing user.id for a correctly signed, fresh initData string', () => {
    const raw = signedInitData(new Date());
    const parsed = validateAndParse(raw, BOT_TOKEN);
    expect(parsed.user?.id).toBe(42);
  });

  it('throws when the hash parameter has been altered by one character', () => {
    const raw = signedInitData(new Date());
    const altered = raw.replace(/hash=([0-9a-f])/, (_m, firstChar: string) => {
      const flipped = firstChar === '0' ? '1' : '0';
      return `hash=${flipped}`;
    });
    expect(() => validateAndParse(altered, BOT_TOKEN)).toThrow();
  });

  it('throws when signed with a different bot token', () => {
    const raw = signedInitData(new Date());
    expect(() => validateAndParse(raw, 'a-completely-different-token')).toThrow();
  });

  it('throws when auth_date is older than the freshness bound', () => {
    const stale = new Date(Date.now() - (MAX_AUTH_AGE_SECONDS + 60) * 1000);
    const raw = signedInitData(stale);
    expect(() => validateAndParse(raw, BOT_TOKEN)).toThrow();
  });

  it('throws for an empty string', () => {
    expect(() => validateAndParse('', BOT_TOKEN)).toThrow();
  });

  it('throws an ordinary error, never returning a partially trusted object on failure', () => {
    let caught: unknown;
    try {
      validateAndParse('', BOT_TOKEN);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});
