import { describe, expect, it, vi } from 'vitest';
import { processMeal, type PipelineDeps, type ProcessMealArgs } from './voice-pipeline.js';
import { DecompositionFailedError, type DecompositionResult } from '../adapters/llm/types.js';
import type { Transcriber, TranscriptionResult } from '../adapters/stt/types.js';
import type { Embedder } from '../adapters/embeddings/types.js';
import type { FdcCandidate, FdcRepository } from '../domain/fdc-matching/index.js';
import { pipelineCopy } from '../bot/formatting/pipeline-copy.js';

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

/** Fake MessageEditor -- records every edit call. */
function fakeEditor() {
  const calls: { chatId: number; messageId: number; text: string }[] = [];
  return {
    calls,
    async editMessage(chatId: number, messageId: number, text: string) {
      calls.push({ chatId, messageId, text });
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
    const db = fakeDb();

    const deps: PipelineDeps = { db: db as never, transcriber, decomposer, embedder, repo, editor };
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
    const db = fakeDb();

    const deps: PipelineDeps = { db: db as never, transcriber, decomposer, embedder, repo, editor };
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
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
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
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
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
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
    };

    await processMeal(deps, baseArgs());

    const draft = db.inserted[0] as {
      components: { weakMatch: boolean; chosenFdcId: number | null }[];
    };
    expect(draft.components[0]?.weakMatch).toBe(true);
    expect(draft.components[1]?.weakMatch).toBe(true);
    expect(draft.components[1]?.chosenFdcId).toBeNull();
  });

  it('on success: saveDraft called once, editor.editMessage called once with the result card, markUpdateStatus called with done, logCost called once', async () => {
    const decomposer = fakeDecomposer(
      decompositionResult([{ component: 'банан', component_en: 'banana, raw', grams: 120 }]),
    );
    const embedder = fakeEmbedder();
    const repo = fakeRepo([candidate()]);
    const editor = fakeEditor();
    const db = fakeDb();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
    };
    const args = baseArgs();

    await processMeal(deps, args);

    expect(db.inserted).toHaveLength(1);
    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.messageId).toBe(args.ackMessageId);
    expect(editor.calls[0]?.text).toMatch(/Вот что я распознал/);
    expect(db.statusUpdates).toEqual(['done']);
    expect(logSpy).toHaveBeenCalledTimes(1);

    logSpy.mockRestore();
  });

  it('empty decomposition: editMessage receives noFood, saveDraft NOT called, markUpdateStatus done, decompose called exactly once (D-08)', async () => {
    const decomposer = fakeDecomposer(decompositionResult([]));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
    };

    await processMeal(deps, baseArgs());

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.noFood);
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
    const db = fakeDb();

    const deps: PipelineDeps = { db: db as never, transcriber, decomposer, embedder, repo, editor };
    const args = baseArgs({ input: { kind: 'voice', audio: Buffer.from('x'), durationSeconds: 2 } });

    await expect(processMeal(deps, args)).resolves.toBeUndefined();

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.sttFailed);
    expect(db.statusUpdates).toEqual(['failed']);
    expect(decomposer.calls).toHaveLength(0);
  });

  it('DecompositionFailedError: editMessage receives decompositionFailed, markUpdateStatus failed, embedder never called', async () => {
    const decomposer = fakeDecomposer(new DecompositionFailedError());
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
    };

    await expect(processMeal(deps, baseArgs())).resolves.toBeUndefined();

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.decompositionFailed);
    expect(db.statusUpdates).toEqual(['failed']);
    expect(embedder.calls).toHaveLength(0);
  });

  it('a non-DecompositionFailedError thrown by decompose(): editMessage receives internalError, markUpdateStatus failed', async () => {
    const decomposer = fakeDecomposer(new Error('unexpected'));
    const embedder = fakeEmbedder();
    const repo = fakeRepo([]);
    const editor = fakeEditor();
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
    };

    await expect(processMeal(deps, baseArgs())).resolves.toBeUndefined();

    expect(editor.calls[0]?.text).toBe(pipelineCopy.internalError);
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
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
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
    const db = fakeDb();

    const deps: PipelineDeps = {
      db: db as never,
      transcriber: fakeTranscriber({ text: 'unused', model: 'x', usage: {} }),
      decomposer,
      embedder,
      repo,
      editor,
    };
    const args = baseArgs({ ackMessageId: 999 });

    await processMeal(deps, args);

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.messageId).toBe(999);
  });
});
