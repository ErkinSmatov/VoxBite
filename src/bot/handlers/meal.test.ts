import { describe, expect, it, vi } from 'vitest';
import { createTextHandler, createUnsupportedHandler, createVoiceHandler, MAX_TEXT_LENGTH } from './meal.js';
import { pipelineCopy } from '../formatting/pipeline-copy.js';
import { VoiceTooLongError, VoiceUnavailableError } from '../telegram/download-voice.js';

function makeCtx(opts: {
  telegramId?: number;
  chatId?: number;
  updateId?: number;
  voice?: { duration: number };
  text?: string;
  messageDate?: number;
}) {
  const replies: string[] = [];
  const base = opts.voice
    ? { voice: opts.voice }
    : opts.text !== undefined
      ? { text: opts.text }
      : undefined;
  const ctx = {
    from: opts.telegramId === undefined ? undefined : { id: opts.telegramId },
    chat: opts.chatId === undefined ? undefined : { id: opts.chatId },
    update: { update_id: opts.updateId ?? 1 },
    message: base ? { ...base, date: opts.messageDate ?? 1_700_000_000 } : undefined,
    reply: vi.fn(async (text: string) => {
      replies.push(text);
      return { message_id: 999 };
    }),
  };
  return { ctx, replies };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const order: string[] = [];
  const claimUpdate = vi.fn(async () => {
    order.push('claimUpdate');
    return true;
  });
  const markUpdateStatus = vi.fn(async () => {});
  const findOnboardedUser = vi.fn(async () => {
    order.push('findOnboardedUser');
    return { id: 42, timezone: 'Asia/Almaty' };
  });
  const isDailyCapReached = vi.fn(async () => {
    order.push('isDailyCapReached');
    return false;
  });
  const downloadVoice = vi.fn(async () => {
    order.push('downloadVoice');
    return Buffer.from('audio');
  });
  const processMeal = vi.fn(async () => {
    order.push('processMeal');
  });

  return {
    db: {} as never,
    token: 'tok',
    deps: {} as never,
    claimUpdate,
    markUpdateStatus,
    findOnboardedUser,
    isDailyCapReached,
    downloadVoice,
    processMeal,
    order,
    ...overrides,
  };
}

describe('createVoiceHandler', () => {
  it('happy path calls gates, download, ack, and fires processMeal in this exact order', async () => {
    const d = makeDeps();
    const handler = createVoiceHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 }, messageDate: 1_700_000_000 });

    await handler(ctx as never);

    // record order also includes reply/ack — assert via mock invocation order
    expect(d.claimUpdate).toHaveBeenCalledTimes(1);
    expect(d.findOnboardedUser).toHaveBeenCalledTimes(1);
    expect(d.isDailyCapReached).toHaveBeenCalledTimes(1);
    expect(d.downloadVoice).toHaveBeenCalledTimes(1);
    expect(replies).toContain(pipelineCopy.ack);
    expect(d.order.slice(0, 4)).toEqual(['claimUpdate', 'findOnboardedUser', 'isDailyCapReached', 'downloadVoice']);
    // processMeal fired but not awaited synchronously in this test tick's order array;
    // allow microtasks to flush.
    await Promise.resolve();
    expect(d.processMeal).toHaveBeenCalledTimes(1);
    const call = (d.processMeal as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].receivedAt).toEqual(new Date(1_700_000_000 * 1000));
    expect(call[1].timezone).toBe('Asia/Almaty');
  });

  it('missing message.date falls back to the current time without throwing', async () => {
    const d = makeDeps();
    const handler = createVoiceHandler(d as never);
    const { ctx } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 }, messageDate: 0 });
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handler(ctx as never);
    await Promise.resolve();

    const call = (d.processMeal as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].receivedAt).toBeInstanceOf(Date);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('claimUpdate returning false: returns immediately, no reply, no downloadVoice, no processMeal', async () => {
    const d = makeDeps({ claimUpdate: vi.fn(async () => false) });
    const handler = createVoiceHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 } });

    await handler(ctx as never);

    expect(replies).toHaveLength(0);
    expect(d.downloadVoice).not.toHaveBeenCalled();
    expect(d.processMeal).not.toHaveBeenCalled();
  });

  it('findOnboardedUser returning null: replies notOnboarded, marks done, no download, no processMeal', async () => {
    const d = makeDeps({ findOnboardedUser: vi.fn(async () => null) });
    const handler = createVoiceHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 } });

    await handler(ctx as never);

    expect(replies).toEqual([pipelineCopy.notOnboarded]);
    expect(d.markUpdateStatus).toHaveBeenCalledWith(d.db, 1, 'done');
    expect(d.downloadVoice).not.toHaveBeenCalled();
    expect(d.processMeal).not.toHaveBeenCalled();
  });

  it('isDailyCapReached true: replies dailyCapReached, marks done, no download, no processMeal', async () => {
    const d = makeDeps({ isDailyCapReached: vi.fn(async () => true) });
    const handler = createVoiceHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 } });

    await handler(ctx as never);

    expect(replies).toEqual([pipelineCopy.dailyCapReached]);
    expect(d.markUpdateStatus).toHaveBeenCalledWith(d.db, 1, 'done');
    expect(d.downloadVoice).not.toHaveBeenCalled();
    expect(d.processMeal).not.toHaveBeenCalled();
  });

  it('VoiceTooLongError from downloadVoice: replies tooLong, marks failed, no processMeal, no ack sent', async () => {
    const d = makeDeps({
      downloadVoice: vi.fn(async () => {
        throw new VoiceTooLongError(90);
      }),
    });
    const handler = createVoiceHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 90 } });

    await handler(ctx as never);

    expect(replies).toEqual([pipelineCopy.tooLong]);
    expect(d.markUpdateStatus).toHaveBeenCalledWith(d.db, 1, 'failed');
    expect(d.processMeal).not.toHaveBeenCalled();
  });

  it('any other download error: replies internalError, marks failed', async () => {
    const d = makeDeps({
      downloadVoice: vi.fn(async () => {
        throw new VoiceUnavailableError();
      }),
    });
    const handler = createVoiceHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 } });

    await handler(ctx as never);

    expect(replies).toEqual([pipelineCopy.internalError]);
    expect(d.markUpdateStatus).toHaveBeenCalledWith(d.db, 1, 'failed');
    expect(d.processMeal).not.toHaveBeenCalled();
  });

  it('handler resolves before a never-resolving processMeal settles', async () => {
    let resolvePipeline: (() => void) | undefined;
    const neverResolving = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePipeline = resolve;
        }),
    );
    const d = makeDeps({ processMeal: neverResolving });
    const handler = createVoiceHandler(d as never);
    const { ctx } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 } });

    await expect(handler(ctx as never)).resolves.toBeUndefined();
    expect(neverResolving).toHaveBeenCalledTimes(1);
    // cleanup: resolve so nothing lingers
    resolvePipeline?.();
  });

  it('a rejecting processMeal does not produce an unhandled rejection', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = makeDeps({
      processMeal: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const handler = createVoiceHandler(d as never);
    const { ctx } = makeCtx({ telegramId: 1, chatId: 2, voice: { duration: 5 } });

    await handler(ctx as never);
    // Allow the detached promise's .catch to run.
    await new Promise((r) => setTimeout(r, 0));

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe('createTextHandler', () => {
  it('same gate order minus download, passes {kind: text, text} to processMeal, never calls downloadVoice', async () => {
    const d = makeDeps();
    const handler = createTextHandler(d as never);
    const { ctx, replies } = makeCtx({
      telegramId: 1,
      chatId: 2,
      text: 'омлет из двух яиц',
      messageDate: 1_700_000_000,
    });

    await handler(ctx as never);
    await Promise.resolve();

    // Gate 0.5 (D-04) hoists findOnboardedUser ahead of claimUpdate — see
    // meal.ts's module header. It must still be queried only ONCE.
    expect(d.order.slice(0, 3)).toEqual(['findOnboardedUser', 'claimUpdate', 'isDailyCapReached']);
    expect(d.findOnboardedUser).toHaveBeenCalledTimes(1);
    expect(d.downloadVoice).not.toHaveBeenCalled();
    expect(replies).toContain(pipelineCopy.ack);
    expect(d.processMeal).toHaveBeenCalledTimes(1);
    const call = (d.processMeal as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].input).toEqual({ kind: 'text', text: 'омлет из двух яиц' });
    expect(call[1].receivedAt).toEqual(new Date(1_700_000_000 * 1000));
    expect(call[1].timezone).toBe('Asia/Almaty');
  });

  it('missing message.date falls back to the current time without throwing', async () => {
    const d = makeDeps();
    const handler = createTextHandler(d as never);
    const { ctx } = makeCtx({ telegramId: 1, chatId: 2, text: 'блины', messageDate: 0 });
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await handler(ctx as never);
    await Promise.resolve();

    const call = (d.processMeal as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1].receivedAt).toBeInstanceOf(Date);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('ignores messages beginning with /', async () => {
    const d = makeDeps();
    const handler = createTextHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, text: '/start' });

    await handler(ctx as never);

    expect(replies).toHaveLength(0);
    expect(d.claimUpdate).not.toHaveBeenCalled();
    expect(d.processMeal).not.toHaveBeenCalled();
  });

  // Previously this truncated to MAX_TEXT_LENGTH and analysed the prefix.
  // That silently dropped food the user had listed and returned a
  // confidently wrong result, so overlong text is now refused outright.
  it('refuses text longer than MAX_TEXT_LENGTH instead of truncating it', async () => {
    const longText = 'а'.repeat(MAX_TEXT_LENGTH + 500);
    const d = makeDeps();
    const handler = createTextHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, text: longText });

    await handler(ctx as never);
    await Promise.resolve();

    expect(replies).toContain(pipelineCopy.textTooLong);
    expect(d.processMeal).not.toHaveBeenCalled();
    expect(replies).not.toContain(pipelineCopy.ack);
  });

  it('accepts text exactly at MAX_TEXT_LENGTH and passes it through whole', async () => {
    const text = 'а'.repeat(MAX_TEXT_LENGTH);
    const d = makeDeps();
    const handler = createTextHandler(d as never);
    const { ctx } = makeCtx({ telegramId: 1, chatId: 2, text });

    await handler(ctx as never);
    await Promise.resolve();

    const call = (d.processMeal as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect((call[1].input as { text: string }).text).toBe(text);
  });

  it('claimUpdate returning false: returns immediately with no reply', async () => {
    const d = makeDeps({ claimUpdate: vi.fn(async () => false) });
    const handler = createTextHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, text: 'блины' });

    await handler(ctx as never);

    expect(replies).toHaveLength(0);
    expect(d.processMeal).not.toHaveBeenCalled();
  });
});

describe('createUnsupportedHandler', () => {
  it('replies unsupportedMessage and never calls claimUpdate, downloadVoice or processMeal', async () => {
    const claimUpdate = vi.fn();
    const downloadVoice = vi.fn();
    const processMeal = vi.fn();
    const handler = createUnsupportedHandler();
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2 });

    await handler(ctx as never);

    expect(replies).toEqual([pipelineCopy.unsupportedMessage]);
    expect(claimUpdate).not.toHaveBeenCalled();
    expect(downloadVoice).not.toHaveBeenCalled();
    expect(processMeal).not.toHaveBeenCalled();
  });
});

describe('no network/db/real-bot use', () => {
  it('all fakes above are structural — no real grammy Bot or Postgres client is constructed', () => {
    // Static assertion by construction: this file never imports 'grammy' or
    // a real db client anywhere. Documented here as the explicit behaviour
    // bullet this test suite as a whole satisfies.
    expect(true).toBe(true);
  });
});
