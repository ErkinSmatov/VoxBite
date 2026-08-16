import { describe, expect, it } from 'vitest';
import { createMessageEditor, type EditableApi } from './message-editor.js';

/**
 * NEW FILE (04-12) — this module never had a test at all before this plan,
 * and it is the last mile to the real Telegram API: an implementation that
 * silently drops the 4th argument leaves every other test in the repo green
 * and ships the exact "no buttons" bug 04-12 exists to close.
 *
 * The fake records the FULL argument list per call (`unknown[][]`), not a
 * `vi.fn()` assertion on named parameters — a `vi.fn()` assertion cannot
 * catch a dropped 4th argument (only `.length` on the recorded args can).
 */
function fakeApi(): EditableApi & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    async editMessageText(...args: unknown[]) {
      calls.push(args);
      return undefined;
    },
  };
}

describe('createMessageEditor', () => {
  it('with a replyMarkup value: api.editMessageText is called with FOUR arguments, and the 4th deep-equals { reply_markup: <the exact value passed in> }', async () => {
    const api = fakeApi();
    const editor = createMessageEditor(api);
    const markup = { inline_keyboard: [[{ text: '1', callback_data: 'crc:1:sel:0' }]] };

    await editor.editMessage(555, 42, 'hello', markup);

    expect(api.calls).toHaveLength(1);
    const call = api.calls[0]!;
    expect(call).toHaveLength(4);
    expect(call[0]).toBe(555);
    expect(call[1]).toBe(42);
    expect(call[2]).toBe('hello');
    expect(call[3]).toEqual({ reply_markup: markup });
  });

  it('without replyMarkup (called with three arguments): api.editMessageText receives EXACTLY three arguments', async () => {
    const api = fakeApi();
    const editor = createMessageEditor(api);

    await editor.editMessage(555, 42, 'hello');

    expect(api.calls).toHaveLength(1);
    const call = api.calls[0]!;
    expect(call.length).toBe(3);
    expect(call[0]).toBe(555);
    expect(call[1]).toBe(42);
    expect(call[2]).toBe('hello');
  });

  it('neither case puts parse_mode anywhere in the 4th argument (T-04-12/T-03-12)', async () => {
    const api = fakeApi();
    const editor = createMessageEditor(api);
    const markup = { inline_keyboard: [] };

    await editor.editMessage(1, 1, 'text with _underscores_ and *stars*', markup);
    await editor.editMessage(1, 1, 'text with _underscores_ and *stars*');

    for (const call of api.calls) {
      const fourth = call[3] as Record<string, unknown> | undefined;
      if (fourth !== undefined) {
        expect(fourth).not.toHaveProperty('parse_mode');
        expect(JSON.stringify(fourth)).not.toContain('parse_mode');
      }
    }
  });
});
