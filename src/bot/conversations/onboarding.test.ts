/**
 * Drives `onboardingConversation` against a hand-written fake `Conversation`
 * handle and a scripted queue of incoming updates. No Telegram connection, no
 * database connection, no `@grammyjs/conversations` runtime — the fake
 * implements only the three members the conversation actually uses
 * (`waitFor`, `external`, `halt`), matching the signatures quoted in
 * onboarding.ts's module doc comment.
 *
 * The point of the harness is that the failure modes fixed in CR-01/CR-02/CR-03
 * are all *sequencing* bugs — they only show up when a whole run is played
 * through, so a unit test of any single helper cannot catch them.
 */
import { describe, expect, it, vi } from 'vitest';
import { questionCopy } from '../formatting/onboarding-copy.js';
import { onboardingConversation } from './onboarding.js';

type ScriptItem =
  | { kind: 'callback'; data: string; ackRejects?: boolean }
  | { kind: 'text'; text: string };

const cb = (data: string, ackRejects = false): ScriptItem => ({ kind: 'callback', data, ackRejects });
const txt = (text: string): ScriptItem => ({ kind: 'text', text });

/** The happy-path answer sequence for a "снижение веса, 0.5 кг/мес" profile. */
const FULL_ANSWERS: ScriptItem[] = [
  cb('sex:male'),
  txt('29'),
  txt('178'),
  txt('72.5'),
  cb('activity:medium'),
  cb('goal:loss'),
  cb('rate:0.5'),
  cb('tz:Asia/Almaty'),
];

/** Thrown by the fake `conversation.halt()`, which returns `Promise<never>`. */
class HaltSignal extends Error {
  constructor() {
    super('halted');
  }
}

/** Signals that the conversation asked for more updates than the script provides. */
class ScriptExhausted extends Error {
  constructor() {
    super('conversation script exhausted');
  }
}

function makeHarness(script: ScriptItem[], opts: { telegramId?: number } = {}) {
  const replies: string[] = [];
  const acks: Array<{ data: string; rejected: boolean }> = [];

  const reply = vi.fn(async (text: string) => {
    replies.push(text);
    return {};
  });

  const ctx = { from: { id: opts.telegramId ?? 123456789 }, reply };

  const queue = [...script];
  let halted = false;

  function innerCtxFor(item: ScriptItem) {
    if (item.kind === 'callback') {
      return {
        ...ctx,
        callbackQuery: { data: item.data },
        answerCallbackQuery: vi.fn(async () => {
          acks.push({ data: item.data, rejected: item.ackRejects === true });
          if (item.ackRejects === true) {
            throw new Error(
              "Call to 'answerCallbackQuery' failed! (400: Bad Request: query is too old and response timeout expired or query ID is invalid)",
            );
          }
          return true;
        }),
      };
    }
    return { ...ctx, message: { text: item.text } };
  }

  const conversation = {
    async waitFor(query: string | string[], options?: { otherwise?: (c: unknown) => unknown }) {
      const accepted = Array.isArray(query) ? query : [query];
      for (;;) {
        const item = queue.shift();
        if (item === undefined) {
          throw new ScriptExhausted();
        }
        const kind = item.kind === 'callback' ? 'callback_query:data' : 'message:text';
        const inner = innerCtxFor(item);
        if (accepted.includes(kind)) {
          return inner;
        }
        await options?.otherwise?.(inner);
      }
    },
    async external(op: (() => unknown) | { task: () => unknown }) {
      return typeof op === 'function' ? await op() : await op.task();
    },
    async halt(): Promise<never> {
      halted = true;
      throw new HaltSignal();
    },
  };

  async function run(db: unknown): Promise<{ halted: boolean; exhausted: boolean }> {
    try {
      await onboardingConversation(conversation as never, ctx as never, db as never);
      return { halted, exhausted: false };
    } catch (error) {
      if (error instanceof HaltSignal) {
        return { halted: true, exhausted: false };
      }
      if (error instanceof ScriptExhausted) {
        return { halted, exhausted: true };
      }
      throw error;
    }
  }

  return { run, replies, acks, ctx };
}

/** Fake `db` shaped like `save-user.test.ts`'s, with a scriptable failure. */
function makeFakeDb(failures = 0) {
  let remainingFailures = failures;
  const saved: unknown[] = [];
  const db = {
    insert() {
      return {
        values(values: unknown) {
          return {
            onConflictDoUpdate() {
              if (remainingFailures > 0) {
                remainingFailures -= 1;
                return Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
              }
              saved.push(values);
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
  return { db, saved };
}

describe('onboardingConversation — happy path', () => {
  it('collects every answer and saves once on «Всё верно»', async () => {
    const { db, saved } = makeFakeDb();
    const { run, replies } = makeHarness([...FULL_ANSWERS, cb('confirm:yes')]);

    const result = await run(db);

    expect(result.exhausted).toBe(false);
    expect(saved).toHaveLength(1);
    expect(replies.at(-1)).toBe(questionCopy.saved);
  });
});

describe('onboardingConversation — CR-02: stale callback queries', () => {
  // Before the fix, an `answerCallbackQuery` rejection propagated out of the
  // conversation, which makes the conversations plugin exit and delete the
  // replay state — every collected answer lost, no message to the user.
  it('survives a "query is too old" rejection on the very first button', async () => {
    const { db, saved } = makeFakeDb();
    const { run } = makeHarness([
      cb('sex:male', true),
      ...FULL_ANSWERS.slice(1),
      cb('confirm:yes'),
    ]);

    const result = await run(db);

    expect(result.exhausted).toBe(false);
    expect(saved).toHaveLength(1);
  });

  // The worst case: the rejection lands on the confirm screen, after all seven
  // answers are collected but before the write.
  it('survives a rejection on the confirm button and still saves', async () => {
    const { db, saved } = makeFakeDb();
    const { run, replies } = makeHarness([...FULL_ANSWERS, cb('confirm:yes', true)]);

    const result = await run(db);

    expect(result.exhausted).toBe(false);
    expect(saved).toHaveLength(1);
    expect(replies.at(-1)).toBe(questionCopy.saved);
  });

  it('survives a rejection on every single button press', async () => {
    const { db, saved } = makeFakeDb();
    const script = [...FULL_ANSWERS, cb('confirm:yes')].map((item) =>
      item.kind === 'callback' ? cb(item.data, true) : item,
    );
    const { run, acks } = makeHarness(script);

    const result = await run(db);

    expect(result.exhausted).toBe(false);
    expect(saved).toHaveLength(1);
    expect(acks.every((a) => a.rejected)).toBe(true);
  });
});
