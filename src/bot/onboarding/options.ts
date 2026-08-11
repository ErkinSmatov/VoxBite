/**
 * options — button option lists for the onboarding conversation (ONBOARD-01)
 * and their safe `callback_data` decoding.
 *
 * The `value` fields here must stay identical to the Postgres `check`
 * constraint literals in src/db/schema/users.ts, since these strings are
 * written straight into that table.
 *
 * `callback_data` arrives from the Telegram client and can be forged by a
 * modified client — `decodeOption` never trusts it directly (never
 * `split(':')[1]` + cast); it is always a lookup against the known option
 * list, returning `undefined` for anything not found (T-02-04).
 *
 * Zero grammY imports — InlineKeyboard construction happens in Plan 05's
 * src/bot/keyboards/, which reads these lists (D-08).
 */

import type { ActivityLevel, Goal, Sex } from '../../domain/nutrition/index.js';

export interface Option<T extends string> {
  value: T;
  label: string;
  callbackData: string;
}

export const SEX_OPTIONS: readonly Option<Sex>[] = [
  { value: 'male', label: 'Мужской', callbackData: 'sex:male' },
  { value: 'female', label: 'Женский', callbackData: 'sex:female' },
];

export const ACTIVITY_OPTIONS: readonly Option<ActivityLevel>[] = [
  {
    value: 'minimal',
    label: 'Минимальная — сидячая работа, почти нет движения',
    callbackData: 'activity:minimal',
  },
  {
    value: 'low',
    label: 'Низкая — лёгкие прогулки, 1-2 раза в неделю спорт',
    callbackData: 'activity:low',
  },
  {
    value: 'medium',
    label: 'Средняя — тренировки 3-5 раз в неделю',
    callbackData: 'activity:medium',
  },
  {
    value: 'high',
    label: 'Высокая — тренировки почти каждый день',
    callbackData: 'activity:high',
  },
  {
    value: 'very_high',
    label: 'Очень высокая — тяжёлый физический труд или 2 тренировки в день',
    callbackData: 'activity:very_high',
  },
];

export const GOAL_OPTIONS: readonly Option<Goal>[] = [
  { value: 'gain', label: 'Набор веса', callbackData: 'goal:gain' },
  { value: 'loss', label: 'Снижение веса', callbackData: 'goal:loss' },
  { value: 'maintain', label: 'Поддержание веса', callbackData: 'goal:maintain' },
];

export const TIMEZONE_OPTIONS: readonly Option<string>[] = [
  { value: 'Asia/Almaty', label: 'Алматы (UTC+5)', callbackData: 'tz:Asia/Almaty' },
  { value: 'Asia/Aqtobe', label: 'Актобе (UTC+5)', callbackData: 'tz:Asia/Aqtobe' },
  { value: 'Asia/Tashkent', label: 'Ташкент (UTC+5)', callbackData: 'tz:Asia/Tashkent' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)', callbackData: 'tz:Europe/Moscow' },
  { value: 'Asia/Dubai', label: 'Дубай (UTC+4)', callbackData: 'tz:Asia/Dubai' },
  { value: 'Europe/Berlin', label: 'Берлин (UTC+1/+2)', callbackData: 'tz:Europe/Berlin' },
];

export const DEFAULT_TIMEZONE = 'Asia/Almaty';

export function decodeOption<T extends string>(
  options: readonly Option<T>[],
  callbackData: string | undefined,
): T | undefined {
  if (!callbackData) {
    return undefined;
  }
  return options.find((o) => o.callbackData === callbackData)?.value;
}
