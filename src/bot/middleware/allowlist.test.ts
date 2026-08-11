import { describe, expect, it, vi } from 'vitest';
import { createAllowlistMiddleware, parseAllowlist } from './allowlist.js';

const PARSE_CASES: Array<[string | undefined, number[]]> = [
  [undefined, []],
  ['', []],
  ['   ', []],
  ['123,456', [123, 456]],
  [' 123 , 456 ', [123, 456]],
  ['123, 456,,abc', [123, 456]],
  ['-5,0,1.5,123', [123]],
  ['NaN,Infinity,123', [123]],
];

describe('parseAllowlist', () => {
  it.each(PARSE_CASES)('parseAllowlist(%j) -> %j', (input, expected) => {
    expect([...parseAllowlist(input)].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b));
  });

  it('preserves a 12-digit Telegram ID (above the 32-bit int range)', () => {
    const id = 123456789012;
    expect(parseAllowlist(String(id))).toEqual(new Set([id]));
  });

  it('never throws for garbage input', () => {
    expect(() => parseAllowlist(',,,,')).not.toThrow();
    expect(() => parseAllowlist('!!!@#$')).not.toThrow();
  });
});

interface FakeCtx {
  from?: { id: number; username?: string };
  reply: (text: string) => Promise<void>;
}

function makeCtx(from?: { id: number; username?: string }): { ctx: FakeCtx; replies: string[] } {
  const replies: string[] = [];
  const ctx: FakeCtx = {
    from,
    reply: async (text: string) => {
      replies.push(text);
    },
  };
  return { ctx, replies };
}

describe('createAllowlistMiddleware', () => {
  it('calls next() exactly once for an allowlisted user', async () => {
    const middleware = createAllowlistMiddleware(new Set([111]));
    const { ctx } = makeCtx({ id: 111, username: 'alice' });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('never calls next() for a non-allowlisted user', async () => {
    const middleware = createAllowlistMiddleware(new Set([111]));
    const { ctx } = makeCtx({ id: 999, username: 'bob' });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    expect(next).not.toHaveBeenCalled();
  });

  it('logs the exact отказ: line for a rejected user with a username', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const middleware = createAllowlistMiddleware(new Set());
    const { ctx } = makeCtx({ id: 42, username: 'carol' });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    expect(logSpy).toHaveBeenCalledWith('отказ: telegram_id=42, @carol');
    logSpy.mockRestore();
  });

  it('logs (нет username) when the user has no username', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const middleware = createAllowlistMiddleware(new Set());
    const { ctx } = makeCtx({ id: 42 });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    expect(logSpy).toHaveBeenCalledWith('отказ: telegram_id=42, @(нет username)');
    logSpy.mockRestore();
  });

  it('logged line matches /^отказ: telegram_id=\\d+, @/', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const middleware = createAllowlistMiddleware(new Set());
    const { ctx } = makeCtx({ id: 7 });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    const loggedLine = logSpy.mock.calls.map((c) => c[0]).find((l) => typeof l === 'string' && l.startsWith('отказ:'));
    expect(loggedLine).toMatch(/^отказ: telegram_id=\d+, @/);
    logSpy.mockRestore();
  });

  it('replies exactly once on rejection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const middleware = createAllowlistMiddleware(new Set());
    const { ctx, replies } = makeCtx({ id: 42, username: 'carol' });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    expect(replies).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('does not throw and rejects when ctx.from is undefined', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const middleware = createAllowlistMiddleware(new Set([111]));
    const { ctx, replies } = makeCtx(undefined);
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(middleware(ctx as any, next as any)).resolves.not.toThrow();

    expect(next).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it('empty allowlist rejects every user (D-04, fail-closed)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const middleware = createAllowlistMiddleware(new Set());
    const { ctx } = makeCtx({ id: 1, username: 'anyone' });
    const next = vi.fn(async () => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(ctx as any, next as any);

    expect(next).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
