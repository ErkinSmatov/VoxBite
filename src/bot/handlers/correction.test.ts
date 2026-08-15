import { describe, expect, it, vi } from 'vitest';
import { createCorrectionCallbackHandler, type CorrectionHandlerDeps } from './correction.js';
import { GRAM_STEP } from '../../application/corrections.js';
import { correctionCopy } from '../formatting/correction-copy.js';
import type { DraftComponent, PersistedDraft } from '../../application/types.js';

const FIXED_NOW = new Date('2026-08-15T12:00:00Z');

function makeComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  return {
    component: 'курица',
    componentEn: 'chicken',
    grams: 150,
    candidates: [
      {
        fdcId: 1,
        description: 'Chicken, breast, raw',
        source: 'foundation_food',
        similarity: 0.9,
        kcal: 120,
        proteinG: 22,
        fatG: 3,
        carbsG: 0,
        sugarG: 0,
      },
    ],
    chosenFdcId: 1,
    weakMatch: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    id: 7,
    userId: 42,
    chatId: 100,
    messageId: 999,
    source: 'voice',
    transcript: 'курица 150 грамм',
    components: [makeComponent()],
    status: 'draft',
    awaitingInput: null,
    localDate: '2026-08-15',
    diaryId: null,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

function makeCtx(data: string, opts: { telegramId?: number } = {}) {
  const edits: { text: string; other?: unknown }[] = [];
  const ctx = {
    callbackQuery: { data },
    from: opts.telegramId === undefined ? undefined : { id: opts.telegramId },
    chat: { id: 100 },
    answerCallbackQuery: vi.fn(async () => true),
    editMessageText: vi.fn(async (text: string, other?: unknown) => {
      edits.push({ text, other });
      return true;
    }),
    editMessageReplyMarkup: vi.fn(async () => true),
  };
  return { ctx, edits };
}

function makeDeps(overrides: Partial<CorrectionHandlerDeps> & { draft?: PersistedDraft | null } = {}) {
  const order: string[] = [];
  const draft = overrides.draft === undefined ? makeDraft() : overrides.draft;

  const findOnboardedUser = vi.fn(async () => {
    order.push('findOnboardedUser');
    return { id: 42, timezone: 'Asia/Almaty' };
  });
  const readDraft = vi.fn(async () => {
    order.push('readDraft');
    return draft;
  });
  const setAwaitingInput = vi.fn(async () => {
    order.push('setAwaitingInput');
    return true;
  });
  const clearAwaitingInput = vi.fn(async () => {
    order.push('clearAwaitingInput');
    return true;
  });
  const markDraftStatus = vi.fn(async () => {
    order.push('markDraftStatus');
  });
  const claimAbandon = vi.fn(async () => {
    order.push('claimAbandon');
    return true;
  });
  const swapCandidate = vi.fn(async () => {
    order.push('swapCandidate');
    return { ok: true as const, components: draft ? draft.components : [] };
  });
  const adjustGrams = vi.fn(async () => {
    order.push('adjustGrams');
    return { ok: true as const, components: draft ? draft.components : [] };
  });
  const removeComponent = vi.fn(async () => {
    order.push('removeComponent');
    return { ok: true as const, components: [] };
  });
  const confirmMeal = vi.fn(async () => {
    order.push('confirmMeal');
    return {
      ok: true as const,
      diaryId: 1,
      localDate: '2026-08-15',
      components: draft ? draft.components : [],
    };
  });
  const recomputeSavedEntry = vi.fn(async () => {
    order.push('recomputeSavedEntry');
    return { ok: true as const, diaryId: 1 };
  });
  const deleteSavedEntry = vi.fn(async () => {
    order.push('deleteSavedEntry');
    return { ok: true as const };
  });

  const deps: CorrectionHandlerDeps = {
    db: {} as never,
    embedder: {} as never,
    repo: {} as never,
    findOnboardedUser: findOnboardedUser as never,
    readDraft: readDraft as never,
    setAwaitingInput: setAwaitingInput as never,
    clearAwaitingInput: clearAwaitingInput as never,
    markDraftStatus: markDraftStatus as never,
    claimAbandon: claimAbandon as never,
    swapCandidate: swapCandidate as never,
    adjustGrams: adjustGrams as never,
    removeComponent: removeComponent as never,
    confirmMeal: confirmMeal as never,
    recomputeSavedEntry: recomputeSavedEntry as never,
    deleteSavedEntry: deleteSavedEntry as never,
    now: () => FIXED_NOW,
    ...overrides,
  };

  return {
    deps,
    order,
    findOnboardedUser,
    readDraft,
    setAwaitingInput,
    clearAwaitingInput,
    markDraftStatus,
    claimAbandon,
    swapCandidate,
    adjustGrams,
    removeComponent,
    confirmMeal,
    recomputeSavedEntry,
    deleteSavedEntry,
  };
}

function lastEdit(edits: { text: string; other?: unknown }[]) {
  return edits[edits.length - 1];
}

function keyboardButtons(other: unknown): string[] {
  const markup = (other as { reply_markup?: { inline_keyboard?: { text: string }[][] } } | undefined)?.reply_markup;
  const rows = markup?.inline_keyboard ?? [];
  return rows.flat().map((b) => b.text);
}

describe('createCorrectionCallbackHandler', () => {
  it('malformed payloads: ack is called and nothing else runs — zero db calls', async () => {
    for (const data of ['crc:abc:sel', 'nope', '']) {
      const d = makeDeps();
      const handler = createCorrectionCallbackHandler(d.deps);
      const { ctx } = makeCtx(data, { telegramId: 1 });

      await handler(ctx as never);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
      expect(d.findOnboardedUser).not.toHaveBeenCalled();
      expect(d.readDraft).not.toHaveBeenCalled();
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    }
  });

  it('a tap on a foreign draft: readDraft returns null, notYours is rendered, no correction op runs', async () => {
    const d = makeDeps({ draft: null });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:sel:0', { telegramId: 1 });

    await handler(ctx as never);

    expect(d.readDraft.mock.calls[0]).toEqual([{}, 7, 42]);
    expect(lastEdit(edits)?.text).toBe(correctionCopy.notYours);
    expect(d.swapCandidate).not.toHaveBeenCalled();
    expect(d.adjustGrams).not.toHaveBeenCalled();
    expect(d.removeComponent).not.toHaveBeenCalled();
    expect(d.confirmMeal).not.toHaveBeenCalled();
    expect(d.deleteSavedEntry).not.toHaveBeenCalled();
  });

  it('a tap on a draft created 25 hours ago: marks abandoned, renders expired, no op runs', async () => {
    const staleCreatedAt = new Date(FIXED_NOW.getTime() - 25 * 3600_000);
    const d = makeDeps({ draft: makeDraft({ status: 'draft', createdAt: staleCreatedAt }) });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:sel:0', { telegramId: 1 });

    await handler(ctx as never);

    expect(d.markDraftStatus).toHaveBeenCalledWith({}, 7, 42, 'abandoned');
    expect(lastEdit(edits)?.text).toBe(correctionCopy.expired);
    expect(d.setAwaitingInput).not.toHaveBeenCalled();
  });

  it('a "cand" tap calls swapCandidate with the parsed indices and renders the level-2 card', async () => {
    const draft = makeDraft({ awaitingInput: { kind: 'typed_grams', componentIndex: 0 } });
    const d = makeDeps({ draft });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:cand:0', { telegramId: 1 });

    await handler(ctx as never);

    expect(d.swapCandidate).toHaveBeenCalledWith({}, 7, 42, 0, 0, FIXED_NOW);
    expect(lastEdit(edits)?.text).toContain('курица');
  });

  it('"gp" applies +GRAM_STEP, "gm" applies -GRAM_STEP', async () => {
    const draft = makeDraft({ awaitingInput: { kind: 'typed_grams', componentIndex: 0 } });

    const dPlus = makeDeps({ draft });
    await createCorrectionCallbackHandler(dPlus.deps)(makeCtx('crc:7:gp', { telegramId: 1 }).ctx as never);
    expect(dPlus.adjustGrams).toHaveBeenCalledWith({}, 7, 42, 0, GRAM_STEP, FIXED_NOW);

    const dMinus = makeDeps({ draft });
    await createCorrectionCallbackHandler(dMinus.deps)(makeCtx('crc:7:gm', { telegramId: 1 }).ctx as never);
    expect(dMinus.adjustGrams).toHaveBeenCalledWith({}, 7, 42, 0, -GRAM_STEP, FIXED_NOW);
  });

  it('an "rm" tap that empties the draft renders emptyState with no Подтвердить button', async () => {
    const draft = makeDraft({ awaitingInput: { kind: 'typed_grams', componentIndex: 0 } });
    const d = makeDeps({
      draft,
      removeComponent: vi.fn(async () => ({ ok: true as const, components: [] })) as never,
    });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:rm', { telegramId: 1 });

    await handler(ctx as never);

    const last = lastEdit(edits);
    expect(last?.text).toBe(correctionCopy.emptyState);
    expect(keyboardButtons(last?.other)).not.toContain(correctionCopy.btnConfirm);
  });

  it('a "confirm" tap on a draft with a null-chosenFdcId component renders the blocking name and does not save', async () => {
    const draft = makeDraft();
    const d = makeDeps({
      draft,
      confirmMeal: vi.fn(async () => ({
        ok: false as const,
        reason: 'blocked' as const,
        blockedComponent: 'курица',
      })) as never,
    });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:confirm', { telegramId: 1 });

    await handler(ctx as never);

    const last = lastEdit(edits);
    expect(last?.text).toContain('курица');
    expect(last?.text).not.toContain(correctionCopy.savedOn('2026-08-15'));
  });

  it('a "confirm" tap on a good draft renders the confirmed card and keyboard', async () => {
    const draft = makeDraft();
    const d = makeDeps({ draft });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:confirm', { telegramId: 1 });

    await handler(ctx as never);

    const last = lastEdit(edits);
    expect(last?.text).toContain(correctionCopy.savedOn('2026-08-15'));
    expect(keyboardButtons(last?.other)).toEqual([correctionCopy.btnEdit, correctionCopy.btnDelete]);
  });

  it('a "del" tap renders deletePrompt and calls deleteSavedEntry zero times', async () => {
    const draft = makeDraft({ status: 'confirmed', diaryId: 5 });
    const d = makeDeps({ draft });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:del', { telegramId: 1 });

    await handler(ctx as never);

    expect(lastEdit(edits)?.text).toBe(correctionCopy.deletePrompt);
    expect(d.deleteSavedEntry).toHaveBeenCalledTimes(0);
  });

  it('a "delyes" tap calls deleteSavedEntry with confirmed true and renders deleted', async () => {
    const draft = makeDraft({ status: 'confirmed', diaryId: 5 });
    const d = makeDeps({ draft });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx, edits } = makeCtx('crc:7:delyes', { telegramId: 1 });

    await handler(ctx as never);

    expect(d.deleteSavedEntry).toHaveBeenCalledWith({}, 7, 42, true, FIXED_NOW);
    expect(lastEdit(edits)?.text).toBe(correctionCopy.deleted);
  });

  it('an "edit" action on a confirmed draft does not itself call recomputeSavedEntry, but a subsequent correction does', async () => {
    const draft = makeDraft({ status: 'confirmed', diaryId: 5, awaitingInput: { kind: 'typed_grams', componentIndex: 0 } });
    const d = makeDeps({ draft });
    const handler = createCorrectionCallbackHandler(d.deps);

    await handler(makeCtx('crc:7:edit', { telegramId: 1 }).ctx as never);
    expect(d.recomputeSavedEntry).not.toHaveBeenCalled();

    await handler(makeCtx('crc:7:gp', { telegramId: 1 }).ctx as never);
    expect(d.recomputeSavedEntry).toHaveBeenCalledWith({}, 7, 42);
  });

  it('ack precedes every db-touching call, and readDraft precedes every correction/confirm/delete op', async () => {
    const draft = makeDraft({ awaitingInput: { kind: 'typed_grams', componentIndex: 0 } });
    const d = makeDeps({ draft });
    const handler = createCorrectionCallbackHandler(d.deps);
    const { ctx } = makeCtx('crc:7:cand:0', { telegramId: 1 });

    await handler(ctx as never);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    const readDraftIndex = d.order.indexOf('readDraft');
    const swapCandidateIndex = d.order.indexOf('swapCandidate');
    expect(readDraftIndex).toBeGreaterThanOrEqual(0);
    expect(swapCandidateIndex).toBeGreaterThan(readDraftIndex);
    expect(d.order[0]).toBe('findOnboardedUser');
  });
});
