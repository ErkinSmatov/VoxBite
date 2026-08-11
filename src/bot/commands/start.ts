/**
 * `/start` — the onboarding entry point. Sits behind the allowlist gate like
 * every other handler (src/bot/bot.ts registration order, T-02-23): this
 * file never touches the allowlist itself.
 *
 * Reads the caller's `users` row (never writes — T-02-21) and branches:
 *   - no row, or `onboardedAt` is null (in-progress/never started) -> greet
 *     and enter the onboarding conversation directly.
 *   - `onboardedAt` set and targets present -> show what is already known
 *     and offer a "Пройти анкету заново" button; only pressing that button
 *     (RESTART_ONBOARDING_CALLBACK, handled in bot.ts) enters the
 *     conversation. The stored profile is never silently discarded.
 *   - `onboardedAt` set but `targetKcal` null (an inconsistent row that
 *     should not exist in practice, but is cheap to guard) -> falls back to
 *     entering the conversation rather than rendering `null` in a message.
 */
import type { UserRow } from '../../db/schema/users.js';
import { users } from '../../db/schema/users.js';
import type { Db } from '../../db/client.js';
import { eq } from 'drizzle-orm';
import { InlineKeyboard } from 'grammy';
import type { BotContext } from '../bot.js';
import { questionCopy } from '../formatting/onboarding-copy.js';
import { ONBOARDING_CONVERSATION_ID } from '../conversations/onboarding.js';

/** A user is "fully onboarded" only when both onboardedAt and targetKcal are set. */
type OnboardedUserRow = UserRow & { onboardedAt: Date; targetKcal: number };

function isFullyOnboarded(user: UserRow): user is OnboardedUserRow {
  return user.onboardedAt !== null && user.targetKcal !== null;
}

export const RESTART_ONBOARDING_CALLBACK = 'start:redo-onboarding';

export function buildRestartKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Пройти анкету заново', RESTART_ONBOARDING_CALLBACK);
}

/** Pure — a Russian message summarizing the caller's stored targets. */
export function buildExistingTargetsMessage(user: OnboardedUserRow): string {
  return [
    'С возвращением! Вот твои текущие цели:',
    `Калории: ${user.targetKcal} ккал`,
    `Белки: ${user.targetProteinG} г, Жиры: ${user.targetFatG} г, Углеводы: ${user.targetCarbsG} г`,
    '',
    'Можешь пройти анкету заново, если что-то изменилось.',
  ].join('\n');
}

export function createStartHandler(db: Db) {
  return async (ctx: BotContext): Promise<void> => {
    const telegramId = ctx.from?.id;
    if (telegramId === undefined) {
      return;
    }

    const rows = await db.select().from(users).where(eq(users.telegramId, telegramId)).limit(1);
    const user = rows[0];

    if (user !== undefined && isFullyOnboarded(user)) {
      await ctx.reply(buildExistingTargetsMessage(user), { reply_markup: buildRestartKeyboard() });
      return;
    }

    await ctx.reply(questionCopy.greeting);
    await ctx.conversation.enter(ONBOARDING_CONVERSATION_ID);
  };
}
