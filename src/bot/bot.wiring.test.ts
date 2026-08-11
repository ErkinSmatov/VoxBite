/**
 * Static assertions about the composition root.
 *
 * `createBot()` is not called here on purpose: constructing a `Bot` needs a
 * token, and the properties worth protecting are registration facts, not
 * runtime behaviour. This mirrors the check Plan 02-06 runs as its
 * `<automated>` step, and additionally pins the three CR fixes that live in
 * bot.ts so a future edit cannot quietly undo them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BOT_TS = fileURLToPath(new URL('./bot.ts', import.meta.url));

/** bot.ts with comment lines stripped, so a mention in prose does not count. */
function botSource(): string {
  return readFileSync(BOT_TS, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
}

describe('bot.ts registration order (D-05 / T-02-23)', () => {
  it('registers allowlist -> session -> conversations', () => {
    const source = botSource();
    const allowlist = source.indexOf('createAllowlistMiddleware');
    const sessionCall = source.indexOf('session(');
    const conversation = source.indexOf('createConversation');

    expect(allowlist).toBeGreaterThanOrEqual(0);
    expect(allowlist).toBeLessThan(sessionCall);
    expect(sessionCall).toBeLessThan(conversation);
  });

  it('never starts the bot', () => {
    expect(botSource()).not.toMatch(/bot\.start\(/);
  });
});

describe('bot.ts error and cancel wiring', () => {
  it('uses the shared error handler rather than a bare console.log (CR-01)', () => {
    const source = botSource();
    expect(source).toContain('bot.catch(createErrorHandler())');
    expect(source).not.toMatch(/bot\.catch\(\s*\(err\)\s*=>\s*\{\s*console\.log/);
  });

  it('acknowledges the restart callback through ack(), never bare (CR-02)', () => {
    const source = botSource();
    expect(source).toContain('await ack(ctx)');
    expect(source).not.toContain('ctx.answerCallbackQuery()');
  });

  it('registers /cancel and a bounded conversation config (CR-03)', () => {
    const source = botSource();
    expect(source).toContain("bot.command('cancel'");
    expect(source).toContain('ONBOARDING_CONVERSATION_CONFIG');
  });
});
