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
 */
import type { Conversation } from '@grammyjs/conversations';
import type { Db } from '../../db/client.js';
import { calculateNutritionTargets } from '../../domain/nutrition/index.js';
import type { BotContext } from '../bot.js';
import { targetsWithDisclaimerMessage, questionCopy } from '../formatting/onboarding-copy.js';
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

export const ONBOARDING_CONVERSATION_ID = 'onboarding';

/**
 * Local alias — Plan 06 registers this against the real BotContext for both
 * type parameters (`Conversation<OC, C>`): the outer context (what enters
 * the conversation) and the inner context (what every `waitFor` resolves
 * to) are the same `BotContext` in this bot, since `createConversation` is
 * registered with `<BotContext, BotContext>` in bot.ts.
 */
type OnboardingConversation = Conversation<BotContext, BotContext>;

/**
 * Button step: ask `question`, wait for a `callback_query:data` update, and
 * loop until the callback decodes to a known option value. A text message
 * arriving during this step re-sends the same question (via `otherwise`)
 * instead of being silently ignored. A decodable-but-unknown value (a
 * forged or stale button press, T-02-16) also re-sends the question and
 * keeps waiting — it is never written into the answers object.
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
    const update = await conversation.waitFor('callback_query:data', {
      otherwise: (otherCtx) => otherCtx.reply(question, { reply_markup: buildOptionKeyboard(options, perRow) }),
    });
    await update.answerCallbackQuery();
    const decoded = decodeOption(options, update.callbackQuery.data);
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
    const update = await conversation.waitFor('callback_query:data', {
      otherwise: (otherCtx) => otherCtx.reply(questionCopy.rate, { reply_markup: buildRateKeyboard() }),
    });
    await update.answerCallbackQuery();
    const decoded = decodeRate(update.callbackQuery.data);
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
    const result = parse(update.message.text);
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
    await ctx.reply(confirmMessage, { reply_markup: buildConfirmKeyboard() });

    let decision: string | undefined;
    while (decision === undefined) {
      const update = await conversation.waitFor('callback_query:data', {
        otherwise: (otherCtx) => otherCtx.reply(confirmMessage, { reply_markup: buildConfirmKeyboard() }),
      });
      await update.answerCallbackQuery();
      const data = update.callbackQuery.data;
      if (data === CONFIRM_CALLBACK || data === RESTART_CALLBACK) {
        decision = data;
      } else {
        // Any other value: forged or stale — re-send the confirmation
        // screen and keep waiting.
        await ctx.reply(confirmMessage, { reply_markup: buildConfirmKeyboard() });
      }
    }

    if (decision === CONFIRM_CALLBACK) {
      const telegramId = ctx.from?.id;
      if (telegramId === undefined) {
        throw new Error('onboardingConversation: ctx.from is undefined at confirm time');
      }
      // Every database write inside this conversation goes through
      // conversation.external() (Pitfall 2) — no exceptions.
      await conversation.external(() => saveOnboardedUser(db, { telegramId, answers: completeAnswers, targets }));
      await ctx.reply(questionCopy.saved);
      return;
    }

    // Изменить — nothing was written; loop back to step 1.
    await ctx.reply(questionCopy.restarting);
  }
}
