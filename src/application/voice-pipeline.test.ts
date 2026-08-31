import { describe, expect, it, vi } from 'vitest';
import { processMeal, type PipelineDeps, type ProcessMealArgs } from './voice-pipeline.js';
import { deriveLocalDate } from './local-date.js';
import { DecompositionFailedError, type DecompositionResult } from '../adapters/llm/types.js';
import type { Transcriber, TranscriptionResult } from '../adapters/stt/types.js';
import type { Embedder } from '../adapters/embeddings/types.js';
import type { FdcCandidate, FdcRepository } from '../domain/fdc-matching/index.js';
import { pipelineCopy } from '../bot/formatting/pipeline-copy.js';
import type { OpenCorrectionRenderer } from './types.js';

function makeEmbedding(fill = 0.1): number[] {
  return new Array(1536).fill(fill);
}

function candidate(overrides: Partial<FdcCandidate> = {}): FdcCandidate {
  return {
    fdcId: 1,
    description: 'Chicken, broilers or fryers, breast, meat only, raw',
    source: 'foundation_food',
    kcal: 120,
    proteinG: 22.5,
    fatG: 2.6,
    carbsG: 0,
    sugarG: null,
    similarity: 0.9,
    ...overrides,
  };
}

/** Fake Transcriber -- records call count/args, resolves or rejects on demand. */
function fakeTranscriber(result: TranscriptionResult | Error): Transcriber & { calls: Buffer[] } {
  const calls: Buffer[] = [];
  return {
    calls,
    async transcribe(audio) {
      calls.push(audio);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** Fake DishDecomposer -- records call count/args, resolves or rejects on demand. */
function fakeDecomposer(result: DecompositionResult | Error) {
  const calls: string[] = [];
  return {
    calls,
    async decompose(transcript: string) {
      calls.push(transcript);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** Fake Embedder -- records every call's input array; returns one vector per text. */
function fakeEmbedder(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async embed(texts: string[]) {
      calls.push(texts);
      return texts.map(() => makeEmbedding());
    },
  };
}

/** Fake FdcRepository -- returns the same candidate list for every findNearest call. */
function fakeRepo(rows: FdcCandidate[]): FdcRepository & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async findNearest() {
      calls += 1;
      return rows;
    },
  };
}

/** Fake MessageEditor -- records every edit call, including the optional replyMarkup. */
function fakeEditor() {
  const calls: { chatId: number; messageId: number; text: string; replyMarkup: unknown }[] = [];
  return {
    calls,
    async editMessage(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
      calls.push({ chatId, messageId, text, replyMarkup });
    },
  };
}

/**
 * Fake OpenCorrectionRenderer -- records every renderOpenButton call
 * (draftId only, per D-03: the port structurally cannot receive component
 * data) and returns a card carrying `pipelineCopy.analysisReady` plus a
 * marker object as replyMarkup, so tests can assert the 4th `editMessage`
 * argument was DEFINED without depending on the real bot-layer renderer
 * (that cross-seam proof belongs to `entry-point-reachability.test.ts`, not
 * here).
 */
function fakeOpenRenderer(): OpenCorrectionRenderer & {
  calls: { draftId: number }[];
} {
  const calls: { draftId: number }[] = [];
  return {
    calls,
    renderOpenButton(draftId) {
      calls.push({ draftId });
      return {
        text: `${pipelineCopy.analysisReady}\n[fake card for draft ${draftId}]`,
        replyMarkup: { fakeKeyboardForDraft: draftId },
      };
    },
  };
}

/**
 * Minimal structural fake `db` -- supports exactly the two drizzle chains
 * `saveDraft` and `markUpdateStatus` issue (insert().values().returning(),
 * update().set().where()). No real connection, no drizzle-orm mocking
 * needed since the WHERE condition itself is never inspected here (that's
 * covered by idempotency.test.ts).
 */
function fakeDb() {
  const inserted: unknown[] = [];
  const statusUpdates: string[] = [];
  return {
    inserted,
    statusUpdates,
    insert() {
      return {
        values: (row: unknown) => {
          inserted.push(row);
          return {
            returning: async () => [{ id: 1 }],
          };
        },
      };
    },
    update() {
      return {
        set: (patch: { status: string }) => {
          statusUpdates.push(patch.status);
          return {
            where: async () => undefined,
          };
        },
      };
    },
  };
}

function baseArgs(overrides: Partial<ProcessMealArgs> = {}): ProcessMealArgs {
  return {
    updateId: 1001,
    telegramId: 555,
    userId: 7,
    chatId: 555,
    ackMessageId: 42,
    input: { kind: 'text', text: 'банан 120 грамм' },
    receivedAt: new Date('2026-01-01T12:00:00Z'),
    timezone: 'Asia/Almaty',
    ...overrides,
  };
}

function decompositionResult(
  items: { component: string; component_en: string; grams: number }[],
): DecompositionResult {
  return {
    decomposition: { items },
    usage: { inputTokens: 100, outputTokens: 30 },
    model: 'gpt-4o-mini',
  };
}

describe('processMeal', () => {
  it('voice input: transcriber.transcribe is called exactly once with the Buffer; text flows into decompose', async () => {
    const audio = Buffer.from('fake-ogg-bytes');
    const transcriber = fakeTranscriber({ text: 'банан сто грамм', model: 'gpt-4o-mini-transcribe', usage: {} });
    const decomposer = fakeDecomposer(decompositionResult([]));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = { db: db as never, transcriber, decomposer, embedder, repo, editor, openRenderer };
    const args = baseArgs({ input: { kind: 'voice', audio, durationSeconds: 3.2 } });

    await processMeal(deps, args);

    expect(transcriber.calls).toHaveLength(1);
    expect(transcriber.calls[0]).toBe(audio);
    expect(decomposer.calls).toEqual(['банан сто грамм']);
  });

  it('text input: transcriber.transcribe is NEVER called, and decomposer.decompose receives the typed text', async () => {
    const transcriber = fakeTranscriber({ text: 'unused', model: 'x', usage: {} });
    const decomposer = fakeDecomposer(decompositionResult([]));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = { db: db as never, transcriber, decomposer, embedder, repo, editor, openRenderer };
    const args = baseArgs({ input: { kind: 'text', text: 'омлет из двух яиц' } });

    await processMeal(deps, args);

    expect(transcriber.calls).toHaveLength(0);
    expect(decomposer.calls).toEqual(['омлет из двух яиц']);
  });

  it('a two-component decomposition: embedder.embed called exactly ONCE with both English names, matchIngredient called twice', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([
        { component: 'рис', component_en: 'rice, white, cooked', grams: 150 },
        { component: 'курица', component_en: 'chicken, breast, cooked', grams: 100 },
      ]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]).toEqual(['rice, white, cooked', 'chicken, breast, cooked']);
    expect(repo.calls).toBe(2);
  });

  it('a single-item decomposition produces a draft with exactly one component (DECOMP-02)', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    const draft = db.inserted[0] as { components: unknown[] };
    expect(draft.components).toHaveLength(1);
  });

  it('a weak-match component (below threshold) is present with weakMatch true; a no-candidate component is present with weakMatch true and chosenFdcId null (D-21)', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([
        { component: 'странный ингредиент', component_en: 'unusual thing', grams: 50 },
        { component: 'неизвестное', component_en: 'unknown thing', grams: 30 },
      ]),
    );
    const embedder = fakeEmbedder();
    let call = 0;
    const repo: FdcRepository = {
      async findNearest() {
        call += 1;
        if (call === 1) return [candidate({ similarity: 0.4 })]; // weak match
        return []; // no candidates at all
      },
    };
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    const draft = db.inserted[0] as {
      components: { weakMatch: boolean; chosenFdcId: number | null }[];
    };
    expect(draft.components[0]?.weakMatch).toBe(true);
    expect(draft.components[1]?.weakMatch).toBe(true);
    expect(draft.components[1]?.chosenFdcId).toBeNull();
  });

  it('on success: saveDraft called once, editor.editMessage called once with the Phase 4 correction card and a defined replyMarkup, markUpdateStatus called with done, logCost called once', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };
    const args = baseArgs();

    await processMeal(deps, args);

    expect(db.inserted).toHaveLength(1);
    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.messageId).toBe(args.ackMessageId);
    expect(editor.calls[0]?.text).toContain(pipelineCopy.analysisReady);
    expect(editor.calls[0]?.replyMarkup).toBeDefined();
    expect(db.statusUpdates).toEqual(['done']);
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });

  it('success path: openRenderer.renderOpenButton is called exactly once, with the draft id saveDraft returned', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    expect(openRenderer.calls).toHaveLength(1);
    // fakeDb's saveDraft always returns { id: 1 } -- exercised again below with
    // a different id so a hardcoded 0/1 in the pipeline could not pass by accident.
    expect(openRenderer.calls[0]?.draftId).toBe(1);
  });

  it('success path: a draft id other than 1 propagates into renderOpenButton (a hardcoded 0/1 would not)', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = {
      inserted: [] as unknown[],
      statusUpdates: [] as string[],
      insert() {
        return {
          values: (row: unknown) => {
            (db.inserted as unknown[]).push(row);
            return { returning: async () => [{ id: 4321 }] };
          },
        };
      },
      update() {
        return {
          set: (patch: { status: string }) => {
            db.statusUpdates.push(patch.status);
            return { where: async () => undefined };
          },
        };
      },
    };

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    expect(openRenderer.calls).toHaveLength(1);
    expect(openRenderer.calls[0]?.draftId).toBe(4321);
    expect(editor.calls[0]?.replyMarkup).toEqual({ fakeKeyboardForDraft: 4321 });
  });

  it('D-07: the saved draft carries localDate derived from receivedAt/timezone', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    const receivedAt = new Date('2026-03-14T15:30:00Z');
    const timezone = 'Asia/Almaty';
    await processMeal(deps, baseArgs({ receivedAt, timezone }));

    const draft = db.inserted[0] as { localDate: string };
    expect(draft.localDate).toBe(deriveLocalDate(receivedAt, timezone));
  });

  it('D-07 motivating case: a just-after-midnight Asia/Almaty instant is filed under the LOCAL day, not the UTC day', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    // Asia/Almaty is UTC+5. 2026-03-15 00:10 local time is 2026-03-14T19:10Z
    // -- still UTC day 14, but the meal was dictated just after LOCAL
    // midnight on the 15th. A naive UTC-date read (or anything computed from
    // the wall clock at confirm time) would silently misfile this under the
    // 14th; deriveLocalDate must return the 15th.
    const receivedAt = new Date('2026-03-14T19:10:00Z');
    const timezone = 'Asia/Almaty';
    await processMeal(deps, baseArgs({ receivedAt, timezone }));

    const draft = db.inserted[0] as { localDate: string };
    expect(draft.localDate).toBe('2026-03-15');
    expect(draft.localDate).toBe(deriveLocalDate(receivedAt, timezone));
  });

  it('D-07: processMeal never rejects when deriveLocalDate throws on an invalid timezone', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await expect(
      processMeal(deps, baseArgs({ timezone: 'Not/A_Real_Zone' })),
    ).resolves.toBeUndefined();

    // The late-failure path ran instead of a rejection: saveDraft never
    // happened, and the ack was edited into the internal-error copy.
    expect(db.inserted).toHaveLength(0);
    expect(editor.calls.at(-1)?.text).toBe(pipelineCopy.internalError);
    expect(db.statusUpdates).toEqual(['failed']);

    vi.restoreAllMocks();
  });

  it('empty decomposition: editMessage receives noFood, saveDraft NOT called, markUpdateStatus done, decompose called exactly once (D-08)', async () => {
    const decomposer = fakeDecomposer(decompositionResult([]));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.noFood);
    expect(editor.calls[0]?.replyMarkup).toBeUndefined();
    expect(openRenderer.calls).toHaveLength(0);
    expect(db.inserted).toHaveLength(0);
    expect(db.statusUpdates).toEqual(['done']);
    expect(decomposer.calls).toHaveLength(1);
    expect(embedder.calls).toHaveLength(0);
  });

  it('transcriber throwing: editMessage receives sttFailed, markUpdateStatus failed, decomposer never called', async () => {
    const transcriber = fakeTranscriber(new Error('network blip'));
    const decomposer = fakeDecomposer(decompositionResult([]));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = { db: db as never, transcriber, decomposer, embedder, repo, editor, openRenderer };
    const args = baseArgs({ input: { kind: 'voice', audio: Buffer.from('x'), durationSeconds: 2 } });

    await expect(processMeal(deps, args)).resolves.toBeUndefined();

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.sttFailed);
    expect(editor.calls[0]?.replyMarkup).toBeUndefined();
    expect(db.statusUpdates).toEqual(['failed']);
    expect(decomposer.calls).toHaveLength(0);
  });

  it('DecompositionFailedError: editMessage receives decompositionFailed, markUpdateStatus failed, embedder never called', async () => {
    const decomposer = fakeDecomposer(new DecompositionFailedError());
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await expect(processMeal(deps, baseArgs())).resolves.toBeUndefined();

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.decompositionFailed);
    expect(editor.calls[0]?.replyMarkup).toBeUndefined();
    expect(db.statusUpdates).toEqual(['failed']);
    expect(embedder.calls).toHaveLength(0);
  });

  it('a non-DecompositionFailedError thrown by decompose(): editMessage receives internalError, markUpdateStatus failed', async () => {
    const decomposer = fakeDecomposer(new Error('unexpected'));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await expect(processMeal(deps, baseArgs())).resolves.toBeUndefined();

    expect(editor.calls[0]?.text).toBe(pipelineCopy.internalError);
    expect(editor.calls[0]?.replyMarkup).toBeUndefined();
    expect(db.statusUpdates).toEqual(['failed']);
  });

  it('any other thrown error (embedding failure): editMessage receives internalError, markUpdateStatus failed', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder: Embedder = {
      async embed() {
        throw new Error('embedding API down');
      },
    };
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await expect(processMeal(deps, baseArgs())).resolves.toBeUndefined();

    expect(editor.calls[0]?.text).toBe(pipelineCopy.internalError);
    expect(db.statusUpdates).toEqual(['failed']);
  });

  it('any other thrown error (saveDraft failure): editMessage receives internalError, markUpdateStatus failed', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = {
      insert() {
        return {
          values: () => ({
            returning: async () => {
              throw new Error('db write failed');
            },
          }),
        };
      },
      update() {
        return {
          set: (patch: { status: string }) => ({
            where: async () => {
              (db as unknown as { statusUpdates: string[] }).statusUpdates.push(patch.status);
              return undefined;
            },
          }),
        };
      },
      statusUpdates: [] as string[],
    };

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };

    await expect(processMeal(deps, baseArgs())).resolves.toBeUndefined();

    expect(editor.calls[editor.calls.length - 1]?.text).toBe(pipelineCopy.internalError);
    expect(db.statusUpdates).toEqual(['failed']);
  });

  it('processMeal never rejects when the decomposer throws', async () => {
    const decomposer = fakeDecomposer(new Error('boom'));
    const deps: PipelineDeps = {
      db: fakeDb() as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder: fakeEmbedder(),
      repo: fakeRepo([]),
      editor: fakeEditor(),
      openRenderer: fakeOpenRenderer(),
    };

    await expect(processMeal(deps, baseArgs())).resolves.not.toThrow();
  });

  it('editor.editMessage is called exactly once in every scenario, always with the ackMessageId passed in (D-13)', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
      openRenderer,
    };
    const args = baseArgs({ ackMessageId: 999 });

    await processMeal(deps, args);

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.messageId).toBe(999);
  });
});

/**
 * Regression guards for the code-review warnings on cost visibility and on
 * clobbering an already-delivered result card.
 */
describe('processMeal failure accounting', () => {
  function costLines(spy: { mock: { calls: unknown[][] } }): string[] {
    return spy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((l: string) => l.includes('итого'));
  }

  it('logs a cost line when STT fails, so a repeatedly failing user is not invisible spend', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const transcriber = fakeTranscriber(new Error('stt exploded'));
    const decomposer = fakeDecomposer(decompositionResult([]));
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const db = fakeDb();
    const deps: PipelineDeps = {
      db: db as never,
      transcriber,
      decomposer,
      embedder: fakeEmbedder(),
      repo: fakeRepo([]),
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs({ input: { kind: 'voice', audio: Buffer.from('x'), durationSeconds: 4 } }));

    expect(editor.calls.at(-1)?.text).toBe(pipelineCopy.sttFailed);
    const lines = costLines(logSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('LLM: не вызывалась');
    // Never any user content on a cost line.
    expect(lines[0]).not.toContain('банан');

    vi.restoreAllMocks();
  });

  it('logs a cost line when decomposition fails, since STT was already paid for', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const decomposer = fakeDecomposer(new DecompositionFailedError());
    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    const deps: PipelineDeps = {
      db: fakeDb() as never,
      transcriber: fakeTranscriber({ text: 'что-то', model: 'gpt-4o-mini-transcribe', usage: {} }),
      decomposer,
      embedder: fakeEmbedder(),
      repo: fakeRepo([]),
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs({ input: { kind: 'voice', audio: Buffer.from('x'), durationSeconds: 6 } }));

    expect(editor.calls.at(-1)?.text).toBe(pipelineCopy.decompositionFailed);
    const lines = costLines(logSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('STT:');

    vi.restoreAllMocks();
  });

  it('does NOT overwrite a delivered result card when a later step fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const editor = fakeEditor();
    const openRenderer = fakeOpenRenderer();
    // markUpdateStatus('done') is the step after the card is delivered.
    // Make the db's update chain throw to simulate a hiccup at that point.
    const db = fakeDb();
    const brokenDb = {
      ...db,
      update() {
        throw new Error('db hiccup after delivery');
      },
    };

    const deps: PipelineDeps = {
      db: brokenDb as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer: fakeDecomposer(
        decompositionResult([{ component: 'банан', component_en: 'banana', grams: 120 }]),
      ),
      embedder: fakeEmbedder(),
      repo: fakeRepo([candidate()]),
      editor,
      openRenderer,
    };

    await processMeal(deps, baseArgs());

    // The last thing the user saw must be the open-button card, not an error.
    const last = editor.calls.at(-1)?.text ?? '';
    expect(last).not.toBe(pipelineCopy.internalError);
    expect(last).toContain(pipelineCopy.analysisReady);

    vi.restoreAllMocks();
  });
});
