/**
 * error-copy — the Russian strings the bot sends when something broke on our
 * side (CR-01). Kept out of onboarding-copy.ts because these are not part of
 * the onboarding questionnaire: `bot.catch` fires for any handler, in any
 * flow, including ones that do not exist yet.
 *
 * Voice matches the rest of the repo (src/config/env.ts, scripts/check-setup.ts):
 * state the fact, then state what to do. Never blame the user, never expose
 * an internal error string to them — the technical detail goes to the log
 * only.
 *
 * Zero grammY imports — this module only returns strings (D-08).
 */

export const GENERIC_ERROR_TEXT =
  'Что-то пошло не так на моей стороне. Твои последние ответы могли не ' +
  'сохраниться. Отправь /start, чтобы продолжить.';
