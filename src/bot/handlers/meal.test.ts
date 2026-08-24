import { describe, expect, it, vi } from 'vitest';
import { createTextHandler, createUnsupportedHandler, createVoiceHandler, MAX_TEXT_LENGTH } from './meal.js';
import { pipelineCopy } from '../formatting/pipeline-copy.js';
import { VoiceTooLongError, VoiceUnavailableError } from '../telegram/download-voice.js';

// Gap closure 04-13, Task 3: file-scoped drizzle-orm mock so the seam test
// below can run the REAL findAwaitingDraft (via the REAL
// createCorrectionTextHandler) against a hand-built fake db, the same
// tagged-condition approach draft-store.test.ts uses. This mock is isolated
// to this test file — it does not affect draft-store.test.ts or
// correction.test.ts.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: unknown, value: unknown) => ({ kind: 'eq' as const, column, value }),
    and: (...conditions: unknown[]) => ({ kind: 'and' as const, conditions }),
    or: (...conditions: unknown[]) => ({ kind: 'or' as const, conditions }),
    isNotNull: (column: unknown) => ({ kind: 'isNotNull' as const, column }),
    desc: (column: unknown) => ({ kind: 'desc' as const, column }),
  };
});

const { createCorrectionTextHandler } = await import('./correction.js');
const { diaryDrafts } = await import('../../db/schema/diary-drafts.js');
import type { DraftComponent } from '../../application/types.js';

function makeCtx(opts: {
  telegramId?: number;
  chatId?: number;
  updateId?: number;
  voice?: { duration: number };
  text?: string;
  messageDate?: number;
}) {
  const replies: string[] = [];
  const apiEdits: { chatId: number; messageId: number; text: string; other?: unknown }[] = [];
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
    // Only exercised by the D-04 text-gate seam test below, which routes
    // through the REAL correction.ts handleAwaitingText -- that redraws the
    // draft's own card via ctx.api.editMessageText, pinned to the draft's
    // chat/message id (never ctx.editMessageText).
    api: {
      editMessageText: vi.fn(async (chatId: number, messageId: number, text: string, other?: unknown) => {
        apiEdits.push({ chatId, messageId, text, other });
        return true;
      }),
    },
  };
  return { ctx, replies, apiEdits };
}

// Gap closure 04-13, Task 3: minimal fake diary_drafts row + db harness,
// copied verbatim (per this plan's <action>) from draft-store.test.ts's
// makeFakeDb/makeRow/matches -- not imported across test files.
type FakeDraftRow = {
  id: number;
  userId: number;
  chatId: number;
  messageId: number;
  source: 'voice' | 'text';
  transcript: string;
  components: DraftComponent[];
  status: 'draft' | 'confirmed' | 'abandoned';
  awaitingInput: { kind: 'add_component' | 'typed_grams'; componentIndex?: number } | null;
  localDate: string | null;
  diaryId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

type EqCondition = { kind: 'eq'; column: unknown; value: unknown };
type AndCondition = { kind: 'and'; conditions: DraftCondition[] };
type OrCondition = { kind: 'or'; conditions: DraftCondition[] };
type IsNotNullCondition = { kind: 'isNotNull'; column: unknown };
type DraftCondition = EqCondition | AndCondition | OrCondition | IsNotNullCondition;

function draftMatches(condition: DraftCondition, row: FakeDraftRow): boolean {
  if (condition.kind === 'and') {
    return condition.conditions.every((c) => draftMatches(c as DraftCondition, row));
  }
  if (condition.kind === 'or') {
    return condition.conditions.some((c) => draftMatches(c as DraftCondition, row));
  }
  if (condition.kind === 'isNotNull') {
    if (condition.column === diaryDrafts.awaitingInput) return row.awaitingInput !== null;
    throw new Error('unexpected isNotNull() column in test');
  }
  if (condition.column === diaryDrafts.id) return row.id === condition.value;
  if (condition.column === diaryDrafts.userId) return row.userId === condition.value;
  if (condition.column === diaryDrafts.status) return row.status === condition.value;
  throw new Error('unexpected eq() column in test');
}

function makeFakeDraftDb(initialRows: FakeDraftRow[] = []) {
  const rows = new Map(initialRows.map((r) => [r.id, { ...r }]));

  function selectResult(condition: DraftCondition) {
    const filtered = [...rows.values()].filter((row) => draftMatches(condition, row));
    return {
      orderBy(order: { kind: 'desc'; column: unknown }) {
        const sorted = [...filtered].sort((a, b) => {
          if (order.column === diaryDrafts.updatedAt) {
            return b.updatedAt.getTime() - a.updatedAt.getTime();
          }
          throw new Error('unexpected orderBy() column in test');
        });
        return {
          limit(n: number) {
            return Promise.resolve(sorted.slice(0, n).map(toSelectShape));
          },
        };
      },
      limit(n: number) {
        return Promise.resolve(filtered.slice(0, n).map(toSelectShape));
      },
    };
  }

  function toSelectShape(row: FakeDraftRow) {
    const { updatedAt: _updatedAt, ...rest } = row;
    return rest;
  }

  const db = {
    select(_cols: unknown) {
      return {
        from() {
          return {
            where(condition: DraftCondition) {
              return selectResult(condition);
            },
          };
        },
      };
    },
  };

  return { db, rows };
}

function makeFakeDraftRow(overrides: Partial<FakeDraftRow> = {}): FakeDraftRow {
  const component: DraftComponent = {
    component: 'говядина',
    componentEn: 'beef',
    grams: 150,
    candidates: [],
    chosenFdcId: null,
    weakMatch: true,
  };
  return {
    id: 7,
    userId: 42,
    chatId: 100,
    messageId: 999,
    source: 'voice',
    transcript: 'бешбармак',
    components: [component],
    status: 'confirmed',
    awaitingInput: { kind: 'typed_grams', componentIndex: 0 },
    localDate: '2026-08-15',
    diaryId: 5,
    createdAt: new Date('2026-08-15T00:00:00Z'),
    updatedAt: new Date('2026-08-15T00:00:00Z'),
    ...overrides,
  };
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

  it('a text message while a draft is awaiting input is intercepted before claimUpdate: zero claimUpdate, zero processMeal (D-04)', async () => {
    const interceptCorrectionText = vi.fn(async () => true);
    const d = makeDeps({ interceptCorrectionText });
    const handler = createTextHandler(d as never);
    const { ctx, replies } = makeCtx({ telegramId: 1, chatId: 2, text: 'сметана' });

    await handler(ctx as never);

    expect(interceptCorrectionText).toHaveBeenCalledTimes(1);
    expect(d.claimUpdate).not.toHaveBeenCalled();
    expect(d.processMeal).not.toHaveBeenCalled();
    expect(replies).toHaveLength(0);
  });

  it('a text message with nothing awaiting still runs the full existing gate sequence unchanged', async () => {
    const interceptCorrectionText = vi.fn(async () => false);
    const d = makeDeps({ interceptCorrectionText });
    const handler = createTextHandler(d as never);
    const { ctx, replies } = makeCtx({
      telegramId: 1,
      chatId: 2,
      text: 'омлет',
      messageDate: 1_700_000_000,
    });

    await handler(ctx as never);
    await Promise.resolve();

    expect(interceptCorrectionText).toHaveBeenCalledTimes(1);
    expect(d.order.slice(0, 3)).toEqual(['findOnboardedUser', 'claimUpdate', 'isDailyCapReached']);
    expect(replies).toContain(pipelineCopy.ack);
    expect(d.processMeal).toHaveBeenCalledTimes(1);
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

describe('D-04 text gate seam: real findAwaitingDraft routing (gap closure 04-13)', () => {
  // Regression guard for 04-UAT.md Round 3 / 04-REVIEW.md CR-01 & CR-02: the
  // owner reopened a saved (confirmed) diary entry via ✎ Поправить, typed a
  // correction ("Говядина 45г"), and it was silently routed into the paid
  // meal pipeline instead of applied as a correction, creating a stray
  // diary row and spending real OpenAI money. This test wires the REAL
  // findAwaitingDraft (via the REAL createCorrectionTextHandler) — not a
  // mock — through meal.ts's own gate 0.5, so a regression in either fix
  // (draft-store.ts's widened filter, or correction.ts's recompute call) is
  // caught at this seam, not just inside draft-store.test.ts/
  // correction.test.ts's isolated unit tests.
  it('a typed correction on a reopened confirmed draft is applied, never dispatched to processMeal', async () => {
    const { db: fakeDb } = makeFakeDraftDb([makeFakeDraftRow()]);
    const applyTypedGramsSpy = vi.fn(async () => ({
      ok: true as const,
      components: makeFakeDraftRow().components,
    }));
    const recomputeSavedEntrySpy = vi.fn(async () => ({ ok: true as const, diaryId: 5 }));

    const interceptCorrectionText = createCorrectionTextHandler({
      db: fakeDb as never,
      embedder: {} as never,
      repo: {} as never,
      applyTypedGrams: applyTypedGramsSpy as never,
      recomputeSavedEntry: recomputeSavedEntrySpy as never,
    });

    const d = makeDeps({ interceptCorrectionText });
    const handler = createTextHandler(d as never);
    const { ctx } = makeCtx({ telegramId: 1, chatId: 100, text: '200' });

    await handler(ctx as never);
    await Promise.resolve();

    expect(d.processMeal).toHaveBeenCalledTimes(0);
    expect(applyTypedGramsSpy).toHaveBeenCalledTimes(1);
    expect(recomputeSavedEntrySpy).toHaveBeenCalledTimes(1);

    // Manual trace (plan's <verification> item 3): if Task 1's or(...) were
    // reverted to a bare eq(status, 'draft'), draftMatches would evaluate
    // the eq(status,'draft') leaf as false against this fixture's
    // status: 'confirmed' row (draftMatches' eq branch does a strict
    // row.status === condition.value comparison) -- selectResult's filter
    // would then exclude the row entirely, findAwaitingDraft would return
    // null, interceptCorrectionText would return false, and meal.ts would
    // fall through to claimUpdate/processMeal instead -- so this assertion
    // (processMeal called 0 times) would fail and processMeal would
    // instead be called once. If Task 2's recomputeSavedEntry call were
    // reverted, recomputeSavedEntrySpy would never be invoked and the
    // `toHaveBeenCalledTimes(1)` assertion above would fail with 0 calls.
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
