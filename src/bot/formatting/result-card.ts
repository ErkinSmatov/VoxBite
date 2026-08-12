/**
 * result-card — renders the D-18 read-only result card the voice pipeline
 * shows after decomposing and matching a meal, before the user confirms it.
 *
 * The card lists each component, its grams, and its matched FDC description
 * VERBATIM — never translated, rewritten or truncated, because that
 * description is the user's only signal for raw-vs-cooked (see the doc
 * comment on `FdcCandidate.description`). It never shows candidates 2 and 3
 * or a similarity score (D-18 — that would read as a debug dump), and it
 * never shows calorie/protein/fat/carb/sugar numbers (D-20) — those are
 * unconfirmed guesses until Phase 4's confirm step runs the math.
 *
 * Pure function, no I/O, no grammY import. Sent as plain text with no
 * `parse_mode` by the caller (plan 03-07) — so this module does not escape
 * Telegram markup, and an FDC description containing `_` or `*` cannot
 * break rendering.
 */

import type { DraftComponent, MealDraft } from '../../application/types.js';

function formatComponent(c: DraftComponent): string[] {
  const grams = Math.round(c.grams);
  const lines = [`${c.component} — ${grams} г`];

  const top = c.candidates[0];
  if (top) {
    lines.push(top.description);
  } else {
    lines.push('не нашёл подходящую запись');
  }

  if (c.weakMatch) {
    lines.push('⚠️ совпадение слабое, проверь');
  }

  return lines;
}

export function buildResultCard(draft: MealDraft): string {
  const lines: string[] = ['Вот что я распознал:', ''];

  for (const component of draft.components) {
    lines.push(...formatComponent(component));
    lines.push('');
  }

  lines.push('Пока не сохранено — дальше подтверди или поправь разбор, и я посчитаю КБЖУ.');

  return lines.join('\n');
}
