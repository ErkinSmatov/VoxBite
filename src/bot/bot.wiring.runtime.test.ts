/**
 * Runtime registration-order assertions for the composition root.
 *
 * `bot.wiring.test.ts` next door checks the SOURCE TEXT of bot.ts with
 * `indexOf`. That is useful as a cheap tripwire but it is not proof: source
 * position and runtime registration order are different things, and the
 * phase's central security property — that no handler can run before the
 * allowlist gate — deserves proof rather than a text search. (The source
 * check was strong enough to force an `import` declaration to be written
 * halfway down bot.ts purely to satisfy it, which is exactly the kind of
 * contortion that signals the check is measuring the wrong thing.)
 *
 * Here `grammy`'s `Bot` is replaced with a recorder, so what is asserted is
 * the actual sequence of `use`/`on`/`command`/`callbackQuery` calls that
 * `createBot()` performs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const events: string[] = [];

/** Tagged so the recorder can tell the allowlist `use` from every other one. */
const ALLOWLIST_MW = Object.assign(async () => undefined, { __allowlist: true });

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>();
  class RecordingBot {
    use(...mw: unknown[]) {
      const isAllowlist = mw.some((m) => (m as { __allowlist?: boolean } | null)?.__allowlist === true);
      events.push(isAllowlist ? 'use:allowlist' : 'use:other');
      return this;
    }
    on(filter: unknown) {
      events.push(`on:${String(filter)}`);
      return this;
    }
    command(name: unknown) {
      events.push(`command:${String(name)}`);
      return this;
    }
    callbackQuery(trigger: unknown) {
      events.push(`callbackQuery:${String(trigger)}`);
      return this;
    }
    catch() {
      events.push('catch');
      return this;
    }
  }
  return { ...actual, Bot: RecordingBot };
});

vi.mock('./middleware/allowlist.js', () => ({
  createAllowlistMiddleware: () => ALLOWLIST_MW,
}));

// Keep the real adapters (and their API keys) entirely out of this test.
vi.mock('./pipeline-wiring.js', () => ({
  buildMealHandlerDeps: () => ({ db: {}, token: 't', deps: {} }),
}));

vi.mock('./storage/pg-storage-adapter.js', () => ({
  createPgStorageAdapter: () => ({}),
}));

const { createBot } = await import('./bot.js');

function build(): void {
  events.length = 0;
  createBot({
    db: {} as never,
    token: '123456:fake-token-for-tests',
    allowlist: new Set([1]),
    sttModel: 'gpt-4o-mini-transcribe',
  });
}

describe('createBot runtime registration order (D-05 / T-02-23)', () => {
  beforeEach(() => {
    build();
  });

  it('registers the allowlist middleware before anything else', () => {
    expect(events[0]).toBe('use:allowlist');
  });

  it('registers EVERY handler after the allowlist gate', () => {
    const allowlistIndex = events.indexOf('use:allowlist');
    expect(allowlistIndex).toBeGreaterThanOrEqual(0);

    const handlerIndices = events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.startsWith('on:') || e.startsWith('command:') || e.startsWith('callbackQuery:'))
      .map(({ i }) => i);

    // There must actually be handlers, or this assertion is vacuous.
    expect(handlerIndices.length).toBeGreaterThan(0);
    for (const index of handlerIndices) {
      expect(index).toBeGreaterThan(allowlistIndex);
    }
  });

  it('registers the meal handlers this phase added', () => {
    expect(events).toContain('on:message:voice');
    expect(events).toContain('on:message:text');
  });

  it('registers the error handler', () => {
    expect(events).toContain('catch');
  });
});
