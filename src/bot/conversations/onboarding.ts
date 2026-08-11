/**
 * onboarding — the seven-step `@grammyjs/conversations` v2 flow that asks
 * sex, age, height, weight, activity, goal, (rate, when relevant) and
 * timezone one at a time, shows the calculated targets plus the
 * ONBOARD-06 disclaimer, then either saves an idempotent profile or
 * restarts the questionnaire (ONBOARD-05).
 *
 * Orchestration only. Every parse, decode, message string and the whole
 * calorie/macro calculation are delegated to the pure modules built in
 * Plan 02 and Phase 1 — this file writes no Russian copy and no numeric
 * bound of its own (02-PATTERNS.md).
 *
 * Every signature below was confirmed against the installed
 * `@grammyjs/conversations` v2 type definitions
 * (node_modules/@grammyjs/conversations/out/conversation.d.ts,
 * node_modules/@grammyjs/conversations/out/plugin.d.ts) before use, per
 * 02-RESEARCH.md Pitfall 1 (v1-era `conversation.form.*` /
 * `conversation.wait()` / `enterConversation` snippets dominate training
 * data and search results, and must not be used here):
 *
 *   waitFor<Q extends FilterQuery>(query: Q | Q[], opts?: OtherwiseOptions<C>): AndPromise<Filter<C, Q>>
 *   external<R, I = any>(op: ExternalOp<OC, R, I>["task"] | ExternalOp<OC, R, I>): Promise<R>
 *
 * `Conversation` (conversation.d.ts) exposes no `reenter()` method — the
 * installed API confirms 02-RESEARCH.md Assumption A3's fallback branch:
 * "изменить" is implemented as a plain outer `while (true)` loop around the
 * whole question sequence, which needs no plugin API support at all, rather
 * than a recursive call into this exported function (which the plan
 * explicitly forbids) or a non-existent `reenter()` call.
 *
 * Every database write and the calculation call go through
 * `conversation.external()` (RESEARCH.md Pattern 2, Pitfall 2) — the
 * conversation function's body is replayed after every incoming update, so
 * anything whose result must stay identical across replays has to be
 * wrapped, not called directly.
 *
 * Every callback query is acknowledged through `ack()` (src/bot/telegram/ack.ts),
 * never a bare `answerCallbackQuery()` (CR-02). This conversation waits for a
 * button press indefinitely, so a keyboard sitting in the user's history can
 * be tapped a day later — Telegram then rejects the acknowledgement with
 * `400: query is too old`, and an unguarded throw here would make the
 * plugin exit the conversation and discard every answer collected so far.
 */
import type { Conversation } from '@grammyjs/conversations';
import type { Db } from '../../db/client.js';
import { calculateNutritionTargets } from '../../domain/nutrition/index.js';
import type { BotContext } from '../bot.js';
import {
  targetsWithDisclaimerMessage,
  isCancelKeyword,
  questionCopy,
} from '../formatting/onboarding-copy.js';
import {
  CONFIRM_CALLBACK,
  RESTART_CALLBACK,
  buildConfirmKeyboard,
  buildOptionKeyboard,
  buildRateKeyboard,
} from '../keyboards/onboarding-keyboards.js';
import { assembleProfile, type OnboardingAnswers } from '../onboarding/assemble-profile.js';
import {
  ACTIVITY_OPTIONS,
  DEFAULT_TIMEZONE,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  TIMEZONE_OPTIONS,
  decodeOption,
  type Option,
} from '../onboarding/options.js';
import { parseAge, parseHeight, parseWeight, type ParseResult } from '../onboarding/parse-fields.js';
import { RATE_PRESETS_KG_PER_MONTH, decodeRate } from '../onboarding/rate-presets.js';
import { saveOnboardedUser } from '../onboarding/save-user.js';
import { ack } from '../telegram/ack.js';

export const ONBOARDING_CONVERSATION_ID = 'onboarding';

/**
 * CR-03 — an abandoned questionnaire must expire on its own.
 *
 * Conversation state lives in `bot_sessions` under `conv:<chatId>`, so before
 * this cap a user who walked away at "рост в сантиметрах" was answered with
 * the height question forever, across restarts, until the owner deleted a
 * Postgres row by hand. With the cap, the plugin gives up on a wait that has
 * gone unanswered for a day and halts the conversation, clearing that row.
 *
 * A day is long enough that nobody loses a questionnaire they are actually
 * filling in (people put their phone down mid-flow), and short enough that a
 * row holding partially-entered sex/age/height/weight does not linger
 * indefinitely — which also chips away at WR-12's retention problem.
 */
export const ONBOARDING_MAX_WAIT_MS = 24 * 60 * 60 * 1000;

/**
 * The exact config `bot.ts` registers this conversation with. Exported as a
 * value rather than spelled out at the call site so the id and the timeout
 * are testable without booting a bot.
 */
export const ONBOARDING_CONVERSATION_CONFIG = {
  id: ONBOARDING_CONVERSATION_ID,
  maxMillisecondsToWait: ONBOARDING_MAX_WAIT_MS,
} as const;

/**
 * Local alias — Plan 06 registers this against the real BotContext for both
 * type parameters (`Conversation<OC, C>`): the outer context (what enters
 * the conversation) and the inner context (what every `waitFor` resolves
 * to) are the same `BotContext` in this bot, since `createConversation` is
 * registered with `<BotContext, BotContext>` in bot.ts.
 */
type OnboardingConversation = Conversation<BotContext, BotContext>;

/**
 * CR-03 — the one place the conversation exits on the user's request.
 *
 * `conversation.halt()` is the plugin's own supported exit: it ends the
 * conversation and clears its persisted `conv:<chatId>` state. Nothing here
 * touches the storage adapter by hand. It returns `Promise<never>`, so
 * control never comes back from this function when the word matched.
 */
async function cancelIfRequested(
  conversation: OnboardingConversation,
  ctx: BotContext,
  text: string,
): Promise<void> {
  if (!isCancelKeyword(text)) {
    return;
  }
  await ctx.reply(questionCopy.cancelled);
  await conversation.halt();
}

/**
 * Waits for a button press, and returns its raw `callback_data` (never
 * decoded here — decoding stays an allowlist lookup at the call site).
 *
 * Text arriving during a button step is what makes this more than a bare
 * `waitFor`: while a conversation is active it consumes the update and never
 * calls downstream middleware, so a `/cancel` typed at the sex question would
 * otherwise be swallowed and the question re-sent forever (CR-03). Text is
 * therefore waited for alongside the callback query, checked for the cancel
 * word, and only then treated as "wrong kind of answer, re-ask".
 */
async function waitForButtonOrCancel(
  conversation: OnboardingConversation,
  ctx: BotContext,
  reask: () => Promise<unknown>,
): Promise<string | undefined> {
  for (;;) {
    const update = await conversation.waitFor(['callback_query:data', 'message:text'], {
      otherwise: () => reask(),
    });

    const data = update.callbackQuery?.data;
    if (data !== undefined) {
      await ack(update);
      return data;
    }

    const text = update.message?.text;
    if (text !== undefined) {
      await cancelIfRequested(conversation, ctx, text);
    }
    await reask();
  }
}

/**
 * Button step: ask `question`, wait for a button press, and loop until the
 * callback decodes to a known option value. A text message arriving during
 * this step re-sends the same question instead of being silently ignored
 * (unless it is the cancel word — see `waitForButtonOrCancel`). A
 * decodable-but-unknown value (a forged or stale button press, T-02-16) also
 * re-sends the question and keeps waiting — it is never written into the
 * answers object.
 */
async function askOption<T extends string>(
  conversation: OnboardingConversation,
  ctx: BotContext,
  question: string,
  options: readonly Option<T>[],
  perRow = 1,
): Promise<T> {
  const reask = () => ctx.reply(question, { reply_markup: buildOptionKeyboard(options, perRow) });
  await reask();

  for (;;) {
    const data = await waitForButtonOrCancel(conversation, ctx, reask);
    const decoded = decodeOption(options, data);
    if (decoded !== undefined) {
      return decoded;
    }
    await reask();
  }
}

/**
 * Rate step (ONBOARD-02): same shape as `askOption`, but decodes through
 * `decodeRate` against `RATE_PRESETS_KG_PER_MONTH` instead of an `Option`
 * list, so a value above the 1 kg/month cap can never be selected
 * (T-02-17).
 */
async function askRate(conversation: OnboardingConversation, ctx: BotContext): Promise<number> {
  const reask = () => ctx.reply(questionCopy.rate, { reply_markup: buildRateKeyboard() });
  await reask();

  for (;;) {
    const data = await waitForButtonOrCancel(conversation, ctx, reask);
    const decoded = decodeRate(data);
    if (decoded !== undefined && (RATE_PRESETS_KG_PER_MONTH as readonly number[]).includes(decoded)) {
      return decoded;
    }
    await reask();
  }
}

/**
 * Text step: ask `question`, wait for `message:text`, and loop until
 * `parse` succeeds. On failure, reply with the parser's own Russian
 * error (which already contains a concrete example number) and keep
 * waiting — no attempt limit, the user may retry indefinitely. A button
 * press arriving during this step re-sends the question instead of being
 * silently ignored.
 *
 * The unbounded retry loop is only safe because of the cancel check below
 * (CR-03): otherwise a user who cannot produce a parseable number, or who
 * simply changed their mind, has no way out of it at all.
 */
async function askNumber(
  conversation: OnboardingConversation,
  ctx: BotContext,
  question: string,
  parse: (text: string) => ParseResult<number>,
): Promise<number> {
  await ctx.reply(question);

  for (;;) {
    const update = await conversation.waitFor('message:text', {
      otherwise: (otherCtx) => otherCtx.reply(question),
    });
    const text = update.message.text;
    await cancelIfRequested(conversation, ctx, text);
    const result = parse(text);
    if (result.ok) {
      return result.value;
    }
    await ctx.reply(result.error);
  }
}

/**
 * The seven-step onboarding conversation. `db` is a plain dependency
 * (closed over by Plan 06's `createConversation()` registration), not read
 * from `ctx` — matching this repo's existing composition-root style
 * (src/bot/bot.ts's `BotDeps`).
 */
export async function onboardingConversation(
  conversation: OnboardingConversation,
  ctx: BotContext,
  db: Db,
): Promise<void> {
  // CR-03: announce the escape hatch once, before the first question. This is
  // the only point every entry path passes through — `/start` for a new user,
  // the «Пройти анкету заново» button for a returning one, and «Изменить»
  // from the confirm screen all arrive here — so it is the only place the
  // hint is guaranteed to be seen.
  await ctx.reply(questionCopy.cancelHint);

  // Изменить (ONBOARD-05) restarts the whole questionnaire from here,
  // writing nothing — a plain outer loop, since the installed API exposes
  // no `reenter()` method (see module doc comment / Assumption A3).
  for (;;) {
    // Answers are accumulated in a local object, never in ctx.session
    // (conversations own their own replay-safe state via the storage
    // adapter passed to conversations({ storage: ... }) in bot.ts).
    const answers: Partial<OnboardingAnswers> = {};

    // 1. Sex
    answers.sex = await askOption(conversation, ctx, questionCopy.sex, SEX_OPTIONS, 2);

    // 2. Age
    answers.ageYears = await askNumber(conversation, ctx, questionCopy.age, parseAge);

    // 3. Height
    answers.heightCm = await askNumber(conversation, ctx, questionCopy.height, parseHeight);

    // 4. Weight
    answers.weightKg = await askNumber(conversation, ctx, questionCopy.weight, parseWeight);

    // 5. Activity
    answers.activityLevel = await askOption(conversation, ctx, questionCopy.activity, ACTIVITY_OPTIONS);

    // 6. Goal
    answers.goal = await askOption(conversation, ctx, questionCopy.goal, GOAL_OPTIONS);

    // 7. Rate — only when the goal is gain or loss; maintain skips this
    // step entirely and leaves desiredRateKgPerMonth undefined.
    if (answers.goal !== 'maintain') {
      answers.desiredRateKgPerMonth = await askRate(conversation, ctx);
    }

    // 8. Timezone — falls back to DEFAULT_TIMEZONE only if this step
    // somehow yields nothing; normally it is explicitly chosen below.
    answers.timezone = await askOption(conversation, ctx, questionCopy.timezone, TIMEZONE_OPTIONS);
    answers.timezone = answers.timezone ?? DEFAULT_TIMEZONE;

    const completeAnswers = answers as OnboardingAnswers;
    const profile = assembleProfile(completeAnswers);

    // Wrapped per RESEARCH.md Pattern 2: calculateNutritionTargets is pure
    // today, but wrapping it is a cheap defensive margin against a future
    // non-deterministic change corrupting a replay.
    const targets = await conversation.external(() => calculateNutritionTargets(profile));

    // The disclaimer is part of this string by construction (ONBOARD-06)
    // — never composed separately, never optional.
    const confirmMessage = targetsWithDisclaimerMessage(targets);

    // Confirm-and-save loop (CR-01). A failed write must not be fatal: the
    // seven collected answers only exist in this function's local `answers`
    // object, so if the save throws out of here the plugin exits the
    // conversation and every one of them is gone. Instead the failure is
    // caught, reported in Russian, and the confirm screen is re-shown with
    // the answers still in hand — pressing «Всё верно» again retries.
    // Note this loop is INSIDE the outer restart loop deliberately: falling
    // back to the outer loop would reset `answers` and re-ask all seven
    // questions, which is the data loss we are fixing.
    let restartRequested = false;
    while (!restartRequested) {
      await ctx.reply(confirmMessage, { reply_markup: buildConfirmKeyboard() });

      let decision: string | undefined;
      while (decision === undefined) {
        const data = await waitForButtonOrCancel(conversation, ctx, () =>
          ctx.reply(confirmMessage, { reply_markup: buildConfirmKeyboard() }),
        );
        if (data === CONFIRM_CALLBACK || data === RESTART_CALLBACK) {
          decision = data;
        } else {
          // Any other value: forged or stale — re-send the confirmation
          // screen and keep waiting.
          await ctx.reply(confirmMessage, { reply_markup: buildConfirmKeyboard() });
        }
      }

      if (decision === RESTART_CALLBACK) {
        restartRequested = true;
        break;
      }

      const telegramId = ctx.from?.id;
      if (telegramId === undefined) {
        throw new Error('onboardingConversation: ctx.from is undefined at confirm time');
      }

      // Every database write inside this conversation goes through
      // conversation.external() (Pitfall 2) — no exceptions. The catch lives
      // INSIDE the external op so the boolean it resolves to is what gets
      // replayed, rather than a rejection being re-thrown on every replay.
      const saved = await conversation.external(() =>
        saveOnboardedUser(db, { telegramId, answers: completeAnswers, targets })
          .then(() => true)
          .catch((error: unknown) => {
            // Message only — never the answers, which are health data.
            console.error(
              `Не удалось сохранить профиль: ${error instanceof Error ? error.message : String(error)}`,
            );
            return false;
          }),
      );

      if (saved) {
        await ctx.reply(questionCopy.saved);
        return;
      }

      await ctx.reply(questionCopy.saveFailed);
    }

    // Изменить — nothing was written; loop back to step 1.
    await ctx.reply(questionCopy.restarting);
  }
}
