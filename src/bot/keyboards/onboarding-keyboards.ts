/**
 * onboarding-keyboards — the only file in Phase 2 that constructs Telegram
 * markup for the onboarding conversation. Every button rendered here comes
 * exclusively from `src/bot/onboarding/options.ts` and
 * `src/bot/onboarding/rate-presets.ts` (ONBOARD-01, ONBOARD-02) — this file
 * invents no label, no value, and no `callback_data` encoding of its own.
 *
 * `@grammyjs/menu` is deliberately unused here (settled in Plan 01;
 * 02-RESEARCH.md Pitfall 5 / Open Question 3): the Phase 2 onboarding flow
 * is strictly linear (ask -> wait -> next question), so it needs no
 * re-rendering, submenus, or menu-state navigation. Plain `InlineKeyboard`
 * plus `conversation.waitFor('callback_query:data')` is sufficient and
 * keeps this phase's dependency surface small; `@grammyjs/menu` is deferred
 * to Phase 4 (the ingredient-candidate picker).
 */
import { InlineKeyboard } from 'grammy';
import type { Option } from '../onboarding/options.js';
import { RATE_PRESETS_KG_PER_MONTH } from '../onboarding/rate-presets.js';

/**
 * Renders one button per entry in `options`, in the same order, one option
 * per row by default. `perRow: 2` groups them two per row (used for the
 * two-option sex question per 02-RESEARCH.md's sketch).
 */
export function buildOptionKeyboard<T extends string>(
  options: readonly Option<T>[],
  perRow = 1,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((option, index) => {
    kb.text(option.label, option.callbackData);
    // InlineKeyboard already starts a fresh empty row after each .row()
    // call, so only ask for a line break between rows — never after the
    // final button — or an empty trailing row is left in inline_keyboard.
    const isLast = index === options.length - 1;
    if (!isLast && (index + 1) % perRow === 0) {
      kb.row();
    }
  });
  return kb;
}

/**
 * Derives its buttons from RATE_PRESETS_KG_PER_MONTH — the single source of
 * truth for ONBOARD-02's "never faster than 1 kg/month" cap (see
 * rate-presets.ts's own module comment for the three-layer defense this is
 * part of). The `rate:<value>` encoding must match what `decodeRate` in
 * rate-presets.ts expects.
 */
export function buildRateKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  RATE_PRESETS_KG_PER_MONTH.forEach((rate, index) => {
    kb.text(`${rate} кг/мес`, `rate:${rate}`);
    if (index < RATE_PRESETS_KG_PER_MONTH.length - 1) {
      kb.row();
    }
  });
  return kb;
}

export const CONFIRM_CALLBACK = 'confirm:yes';
export const RESTART_CALLBACK = 'confirm:restart';

/** The confirm-or-restart screen shown alongside the calculated targets. */
export function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('Всё верно', CONFIRM_CALLBACK).text('Изменить', RESTART_CALLBACK);
}
