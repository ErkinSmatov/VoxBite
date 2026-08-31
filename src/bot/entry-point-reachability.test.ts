/**
 * entry-point-reachability — the test whose absence let a completely
 * unreachable feature pass 687 green tests (04-UAT.md). 04-10 added
 * registration-ORDER tripwires (is the `crc:` handler wired?), and every one
 * of those passed while no message in the product could produce a `crc:`
 * callback at all: `voice-pipeline.ts` was still rendering the Phase 3
 * read-only card with no keyboard attached.
 *
 * This is a REACHABILITY tripwire, not a registration-order one: it asserts
 * the product's only entry point (`processMeal`, voice AND text) actually
 * emits a Telegram `web_app` button addressed at the persisted draft — the
 * button that opens the phase 04.1 Mini App. It must never be weakened into
 * a registration test.
 *
 * 04.1-02: this test used to assert a `crc:` callback keyboard (the Phase 4
 * chat-native correction card). That flow is retired (D-02/D-03) — the ack
 * message is never rewritten into a card again. This rewrite asserts the
 * NEW reachable surface instead: a `web_app` button carrying `draftId=<id>`,
 * and — per D-03 — that the message text itself carries none of the
 * component/candidate/nutrient data the old card used to show.
 *
 * The renderer under test is sourced from the composition root
 * (`buildMealHandlerDeps` in `src/bot/pipeline-wiring.ts`), NOT from a direct
 * `createMiniAppButtonRenderer()` import — a direct import would only prove
 * "IF you wire the real renderer, the button appears"; sourcing it from the
 * wiring means "someone swapped the renderer out in `pipeline-wiring.ts`"
 * fails this tripwire too.
 */
import { describe, expect, it } from 'vitest';
import { processMeal } from '../application/voice-pipeline.js';
import { buildMealHandlerDeps } from './pipeline-wiring.js';
import { pipelineCopy } from './formatting/pipeline-copy.js';
import type { DecompositionResult } from '../adapters/llm/types.js';
import type { Transcriber, TranscriptionResult } from '../adapters/stt/types.js';
import type { Embedder } from '../adapters/embeddings/types.js';
import type { FdcCandidate, FdcRepository } from '../domain/fdc-matching/index.js';
import type { ProcessMealArgs } from '../application/voice-pipeline.js';

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

function fakeTranscriber(result: TranscriptionResult | Error): Transcriber {
  return {
    async transcribe() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function fakeDecomposer(result: DecompositionResult | Error) {
  return {
    async decompose(_transcript: string) {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function fakeEmbedder(): Embedder {
  return {
    async embed(texts: string[]) {
      return texts.map(() => new Array(1536).fill(0.1));
    },
  };
}

function fakeRepo(rows: FdcCandidate[]): FdcRepository {
  return {
    async findNearest() {
      return rows;
    },
  };
}

/** Records every editMessage call, including the optional replyMarkup, exactly like the real MessageEditor. */
function fakeEditor() {
  const calls: { chatId: number; messageId: number; text: string; replyMarkup: unknown }[] = [];
  return {
    calls,
    async editMessage(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
      calls.push({ chatId, messageId, text, replyMarkup });
    },
  };
}

/** Minimal structural fake db supporting saveDraft's insert().values().returning() and markUpdateStatus's update().set().where(). */
function fakeDb(draftId: number) {
  return {
    insert() {
      return {
        values: () => ({
          returning: async () => [{ id: draftId }],
        }),
      };
    },
    update() {
      return {
        set: () => ({
          where: async () => undefined,
        }),
      };
    },
  };
}

function decompositionResult(
  items: { component: string; component_en: string; grams: number }[],
): DecompositionResult {
  return {
    decomposition: { items },
    usage: { inputTokens: 10, outputTokens: 5 },
    model: 'gpt-4o-mini',
  };
}

function baseArgs(overrides: Partial<ProcessMealArgs> = {}): ProcessMealArgs {
  return {
    updateId: 2001,
    telegramId: 777,
    userId: 3,
    chatId: 777,
    ackMessageId: 84,
    input: { kind: 'text', text: 'банан 120 грамм' },
    receivedAt: new Date('2026-01-01T12:00:00Z'),
    timezone: 'Asia/Almaty',
    ...overrides,
  };
}

const MINI_APP_BASE_URL = 'https://example.vercel.app';

/**
 * Builds a real PipelineDeps whose `openRenderer` comes from the
 * composition root (`buildMealHandlerDeps`) and whose other collaborators
 * are the recording fakes this test needs.
 */
function buildDeps(opts: {
  draftId: number;
  decomposition: DecompositionResult | Error;
  candidates?: FdcCandidate[];
}) {
  const editor = fakeEditor();
  const db = fakeDb(opts.draftId);

  const wired = buildMealHandlerDeps({
    db: db as never,
    token: 'test-token',
    api: { editMessageText: async () => undefined },
    sttModel: '',
    miniAppBaseUrl: MINI_APP_BASE_URL,
    factories: {
      createTranscriber: (() => fakeTranscriber({ text: 'unused', model: 'x', usage: {} })) as never,
      createDecomposer: (() => fakeDecomposer(opts.decomposition)) as never,
      createEmbedder: (() => fakeEmbedder()) as never,
      createRepository: (() => fakeRepo(opts.candidates ?? [candidate()])) as never,
      createEditor: (() => editor) as never,
    },
  });

  // Override the remaining PipelineDeps fields with the recording fakes this
  // test needs -- but openRenderer is left exactly as buildMealHandlerDeps
  // produced it, since that is the seam this tripwire exists to cross.
  const deps = { ...wired.deps };

  return { deps, editor };
}

interface InlineKeyboardLike {
  inline_keyboard: { text: string; web_app?: { url: string }; callback_data?: string }[][];
}

describe('entry-point reachability (04.1-02)', () => {
  it('voice success: exactly one editMessage call carries a non-undefined inline keyboard with exactly one web_app button whose url contains draftId=<the persisted draft id>, and text with none of the fixture component/candidate/nutrient data', async () => {
    const { deps, editor } = buildDeps({
      draftId: 55,
      decomposition: decompositionResult([
        { component: 'банан', component_en: 'banana, raw', grams: 120 },
      ]),
      candidates: [candidate({ description: 'Banana, raw' })],
    });

    await processMeal(deps, baseArgs({ input: { kind: 'voice', audio: Buffer.from('x'), durationSeconds: 2 } }));

    expect(editor.calls).toHaveLength(1);
    const call = editor.calls[0];
    expect(call).toBeDefined();

    const replyMarkup = call?.replyMarkup as InlineKeyboardLike | undefined;
    expect(replyMarkup).toBeDefined();
    const buttons = replyMarkup!.inline_keyboard.flat();
    expect(buttons).toHaveLength(1);

    const button = buttons[0]!;
    expect(button.web_app).toBeDefined();
    expect(button.callback_data).toBeUndefined();
    expect(button.web_app?.url).toContain('draftId=55');

    // D-03: the message text must carry none of the fixture's component
    // name, candidate description, or numeric gram/kcal values.
    const text = call?.text ?? '';
    expect(text).not.toContain('банан');
    expect(text).not.toContain('Banana, raw');
    expect(text).not.toContain('120');
    expect(text).not.toMatch(/kcal|ккал/i);
  });

  it('text entry point delivers the identical web_app button -- not a second, untested path', async () => {
    const { deps, editor } = buildDeps({
      draftId: 56,
      decomposition: decompositionResult([
        { component: 'рис', component_en: 'rice, white, cooked', grams: 150 },
      ]),
      candidates: [candidate({ description: 'Rice, white, cooked' })],
    });

    await processMeal(deps, baseArgs({ input: { kind: 'text', text: 'рис 150 грамм' } }));

    expect(editor.calls).toHaveLength(1);
    const call = editor.calls[0];
    const replyMarkup = call?.replyMarkup as InlineKeyboardLike | undefined;
    expect(replyMarkup).toBeDefined();
    const buttons = replyMarkup!.inline_keyboard.flat();
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.web_app).toBeDefined();
    expect(buttons[0]?.web_app?.url).toContain('draftId=56');

    const text = call?.text ?? '';
    expect(text).not.toContain('рис');
    expect(text).not.toContain('Rice, white, cooked');
    expect(text).not.toContain('150');
  });

  it('negative control: the D-08 (Phase 3) empty-decomposition path delivers pipelineCopy.noFood with NO reply markup', async () => {
    const { deps, editor } = buildDeps({
      draftId: 57,
      decomposition: decompositionResult([]),
    });

    await processMeal(deps, baseArgs());

    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]?.text).toBe(pipelineCopy.noFood);
    expect(editor.calls[0]?.replyMarkup).toBeUndefined();
  });
});
