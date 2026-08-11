import { describe, expect, it, vi } from 'vitest';
import { GrammyError, HttpError } from 'grammy';
import { GENERIC_ERROR_TEXT } from './formatting/error-copy.js';
import { createErrorHandler, describeError } from './error-handler.js';

function makeGrammyError(): GrammyError {
  // GrammyError(message, err, method, payload) — the payload deliberately
  // contains something that must never reach the log.
  return new GrammyError(
    "Call to 'sendMessage' failed!",
    { ok: false, error_code: 400, description: 'Bad Request: query is too old' },
    'sendMessage',
    { chat_id: 123456789, text: 'я съел 200 грамм куриной грудки' },
  );
}

function makeBotError(error: unknown, reply = vi.fn(async (_text: string) => ({}))) {
  const ctx = {
    reply,
    update: {
      update_id: 42,
      message: { text: 'я съел 200 грамм куриной грудки', from: { id: 123456789 } },
    },
    api: { token: 'SECRET-TOKEN-DO-NOT-LOG' },
  };
  return { err: { error, ctx, message: String(error) }, ctx, reply };
}

describe('describeError', () => {
  it('names the method and Telegram error code for a GrammyError', () => {
    const line = describeError(makeGrammyError());
    expect(line).toContain('sendMessage');
    expect(line).toContain('400');
    expect(line).toContain('query is too old');
  });

  it('distinguishes a network failure from a Telegram rejection', () => {
    expect(describeError(new HttpError('network down', new Error('ECONNRESET')))).toMatch(/Нет связи/);
    expect(describeError(makeGrammyError())).toMatch(/Telegram отклонил/);
  });

  it('handles a plain Error and a non-Error throw', () => {
    expect(describeError(new Error('boom'))).toContain('boom');
    expect(describeError('boom')).toContain('boom');
  });

  it('never includes the GrammyError payload (it holds user message text)', () => {
    const line = describeError(makeGrammyError());
    expect(line).not.toContain('куриной грудки');
    expect(line).not.toContain('123456789');
  });
});

describe('createErrorHandler', () => {
  // CR-01 regression: the old handler was `console.log(err.message)` and
  // nothing else, so from the user's side the bot simply stopped responding.
  it('replies to the user instead of failing silently', async () => {
    const log = vi.fn();
    const { err, reply } = makeBotError(new Error('Postgres unreachable'));

    await createErrorHandler({ log })(err as never);

    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]![0]).toBe(GENERIC_ERROR_TEXT);
  });

  it('warns the user their answers may not have been saved', () => {
    expect(GENERIC_ERROR_TEXT).toMatch(/не сохранит/);
  });

  it('logs exactly one line, and never the update or the token', async () => {
    const log = vi.fn();
    const { err } = makeBotError(new Error('Postgres unreachable'));

    await createErrorHandler({ log })(err as never);

    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0] as string;
    expect(line).toContain('Postgres unreachable');
    expect(line).not.toContain('куриной грудки');
    expect(line).not.toContain('SECRET-TOKEN');
    expect(line).not.toContain('update_id');
  });

  it('does not throw when the reply itself fails (no chat / user blocked the bot)', async () => {
    const log = vi.fn();
    const reply = vi.fn(async () => {
      throw new Error('Cannot reply: getChatId is not available');
    });
    const { err } = makeBotError(new Error('boom'), reply as never);

    await expect(createErrorHandler({ log })(err as never)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
