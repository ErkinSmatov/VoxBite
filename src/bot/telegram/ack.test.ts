import { describe, expect, it, vi } from 'vitest';
import { ack } from './ack.js';

describe('ack', () => {
  it('calls answerCallbackQuery', async () => {
    const answerCallbackQuery = vi.fn(async () => true);
    await ack({ answerCallbackQuery });
    expect(answerCallbackQuery).toHaveBeenCalledTimes(1);
  });

  // CR-02 regression: Telegram rejects an aged callback query with
  // `400: query is too old`. Unguarded, that throw propagates out of the
  // onboarding conversation and destroys every collected answer.
  it('swallows a "query is too old" rejection instead of rethrowing', async () => {
    const answerCallbackQuery = vi.fn(async () => {
      throw new Error(
        "Call to 'answerCallbackQuery' failed! (400: Bad Request: query is too old and response timeout expired or query ID is invalid)",
      );
    });
    await expect(ack({ answerCallbackQuery })).resolves.toBeUndefined();
  });

  it('swallows a non-Error rejection too', async () => {
    const answerCallbackQuery = vi.fn(async () => {
      throw 'boom';
    });
    await expect(ack({ answerCallbackQuery })).resolves.toBeUndefined();
  });
});
