/**
 * onboarding-copy — every Russian string the onboarding conversation sends,
 * collected in one module so the owner can review copy in one place
 * (ONBOARD-01, ONBOARD-06). Matches the repo's established "state the fact,
 * then state what to do" voice (src/config/env.ts's buildMissingKeysMessage,
 * scripts/check-setup.ts's explainError) — plain, direct, no marketing tone,
 * no emoji beyond the single warning sign in the disclaimer.
 *
 * Zero grammY imports — this module only returns strings, it never touches
 * a Telegram ctx (D-08).
 */

import type { NutritionTargets } from '../../domain/nutrition/index.js';

// ONBOARD-06 — черновик, требует утверждения владельцем, см. план 02-07.
export const DISCLAIMER_TEXT =
  '⚠️ Важно: VoxBite — не медицинское изделие. Расчёт целевых калорий и БЖУ ' +
  'сделан по общей формуле (Миффлина-Сан Жеора) и носит справочный характер. ' +
  'Он не учитывает заболевания, приём лекарств, беременность и другие ' +
  'индивидуальные особенности. Бот не ставит диагнозов и не назначает ' +
  'лечение. Перед тем как менять питание, посоветуйся с врачом или ' +
  'дипломированным диетологом.';

export function targetsWithDisclaimerMessage(t: NutritionTargets): string {
  const lines = [
    'Твои цели:',
    `Калории: ${t.targetKcal} ккал`,
    `Белки: ${t.proteinG} г, Жиры: ${t.fatG} г, Углеводы: ${t.carbsG} г`,
  ];

  if (t.rateKgPerMonth > 0) {
    lines.push(`Скорость изменения веса: ${t.rateKgPerMonth} кг/мес`);
  }

  if (t.floorApplied) {
    lines.push(
      'Запрошенный темп снижения веса пришлось скорректировать: расчёт ' +
        'упёрся в безопасный минимум калорий, ниже которого без ' +
        'наблюдения врача снижаться нельзя.',
    );
  }

  lines.push('', DISCLAIMER_TEXT);

  return lines.join('\n');
}

export const questionCopy = {
  greeting:
    'Привет! Я VoxBite — посчитаю твои целевые калории и БЖУ и буду вести ' +
    'дневник питания по голосовым сообщениям. Сначала пройдём короткий опрос.',
  sex: 'Укажи свой пол:',
  age: 'Сколько тебе лет? Напиши число, например 29.',
  height: 'Какой у тебя рост в сантиметрах? Напиши число, например 178.',
  weight: 'Какой у тебя вес в килограммах? Напиши число, например 72.5.',
  activity: 'Какой у тебя уровень активности?',
  goal: 'Какая у тебя цель?',
  rate: 'С какой скоростью хочешь двигаться к цели?',
  timezone: 'В каком часовом поясе ты находишься?',
  saved: 'Готово! Твои цели рассчитаны и сохранены.',
  restarting: 'Начинаем заново — предыдущие ответы не сохранены.',
};
