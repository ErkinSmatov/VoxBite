/**
 * correction-card — renders the D-01 two-level correction UI (level 1: the
 * whole meal; level 2: a single component's candidate picker), the D-12
 * empty state, and the D-05 post-save confirmed card. This is where the
 * read-only Phase 3 `result-card.ts` (retired in 04-12) becomes an editing surface.
 *
 * Pure functions, no I/O, no grammY import, plain text only (no markup mode
 * option set by the caller) — same invariants `result-card.ts` established: FDC
 * descriptions are rendered VERBATIM (never truncated/rewritten, D-02's
 * whole basis), because that text is the user's only raw-vs-cooked signal.
 *
 * Unlike `result-card.ts` (which always shows the TOP candidate because
 * Phase 3 had no editing), this module must show whichever candidate the
 * user has CHOSEN (`DraftComponent.chosenFdcId`), which can differ from
 * `candidates[0]` once plan 09's handlers let the user re-select — so the
 * per-component renderer here is intentionally its own implementation
 * rather than a re-export of `result-card.ts`'s `formatComponent`.
 *
 * Rounding convention (04-RESEARCH.md Open Question 2, restated from
 * `calculate-total.ts`): `calculateTotal` returns raw, unrounded floats;
 * rounding to the nearest integer happens HERE, at render time only, inside
 * `formatTotalsBlock` — the single renderer of a `NutrientTotal` into
 * Russian text. No later plan should invent a second rounding rule.
 */

import type { DraftComponent } from '../../application/types.js';
import { calculateTotal } from '../../domain/nutrition/index.js';
import type { NutrientTotal, TotalInputItem } from '../../domain/nutrition/index.js';
import { correctionCopy } from './correction-copy.js';

type NutrientKey = 'kcal' | 'proteinG' | 'fatG' | 'carbsG' | 'sugarG';

const NUTRIENT_META: ReadonlyArray<{ key: NutrientKey; label: string; unit: string }> = [
  { key: 'kcal', label: `Калории`, unit: `ккал` },
  { key: 'proteinG', label: `Белки`, unit: `г` },
  { key: 'fatG', label: `Жиры`, unit: `г` },
  { key: 'carbsG', label: `Углеводы`, unit: `г` },
  { key: 'sugarG', label: `Сахар`, unit: `г` },
];

/**
 * D-09/CALC-02 — the ONLY place in the repo that turns a `NutrientTotal`
 * into Russian text. Builds the `TotalInputItem[]` from each component's
 * grams and the per-100g values of its CHOSEN candidate (never `candidates[0]`
 * blindly, and never a hand-written summation loop — `calculateTotal` is the
 * single source of truth, D-03).
 *
 * A component with `chosenFdcId === null` has no MATCH at all — a different
 * problem than missing nutrient DATA (blocked separately by D-10 in plan
 * 08) — so it contributes nothing here and is not counted toward
 * `contributingCount` or any nutrient's `missingCount`.
 */
export function formatTotalsBlock(components: DraftComponent[], opts: { approximate: boolean }): string {
  const items: TotalInputItem[] = [];

  for (const component of components) {
    if (component.chosenFdcId === null) {
      continue;
    }
    const chosen = component.candidates.find((candidate) => candidate.fdcId === component.chosenFdcId);
    if (!chosen) {
      continue;
    }
    items.push({
      grams: component.grams,
      kcal: chosen.kcal,
      proteinG: chosen.proteinG,
      fatG: chosen.fatG,
      carbsG: chosen.carbsG,
      sugarG: chosen.sugarG,
    });
  }

  const contributingCount = items.length;
  const total: NutrientTotal = calculateTotal(items);

  const lines = NUTRIENT_META.map(({ key, label, unit }) => {
    const value = total[key];
    const missing = total.missingCount[key];

    if (value === null) {
      return `${label}: ${correctionCopy.noData}`;
    }

    const rounded = Math.round(value);

    if (missing === 0) {
      return `${label}: ${rounded} ${unit}`;
    }

    return `${label}: ${correctionCopy.partialTotal(`${rounded} ${unit}`, missing, contributingCount)}`;
  });

  const block = lines.join('\n');

  if (!opts.approximate) {
    return block;
  }

  return `${correctionCopy.previewPrefix} ${block}\n${correctionCopy.notSavedMarker}`;
}

function findChosenCandidate(component: DraftComponent) {
  if (component.chosenFdcId === null) {
    return undefined;
  }
  return component.candidates.find((candidate) => candidate.fdcId === component.chosenFdcId);
}

/** One component's block on the level-1 card: name, grams, chosen candidate
 * description VERBATIM (or `noMatch` when there is none), weak-match flag. */
function formatComponentBlock(component: DraftComponent): string[] {
  const grams = Math.round(component.grams);
  const lines = [`${component.component} — ${grams} г`];

  const chosen = findChosenCandidate(component);
  if (chosen) {
    lines.push(chosen.description);
  } else {
    lines.push(correctionCopy.noMatch);
  }

  if (component.weakMatch) {
    lines.push(`⚠️ совпадение слабое, проверь`);
  }

  return lines;
}

/** D-01 level 1: the whole-meal card, editable via `correction-keyboards.ts`'s
 * `buildLevel1Keyboard`. D-12: an empty component list renders ONLY the
 * empty-state copy — no preview line, nothing else. */
export function buildCorrectionCard(components: DraftComponent[]): string {
  if (components.length === 0) {
    return correctionCopy.emptyState;
  }

  const lines: string[] = [correctionCopy.headerLevel1, ''];

  for (const component of components) {
    lines.push(...formatComponentBlock(component));
    lines.push('');
  }

  lines.push(formatTotalsBlock(components, { approximate: true }));

  return lines.join('\n');
}

/** D-01/D-02 level 2: the single-component candidate editor. Candidate
 * descriptions render VERBATIM as numbered lines (`1.`/`2.`/`3.`) — this
 * text, not a button label, is where the user reads raw-vs-cooked (D-02). */
export function buildComponentEditCard(components: DraftComponent[], index: number): string {
  const component = components[index];
  if (!component) {
    throw new Error(
      `buildComponentEditCard: index ${index} is out of range for a ${components.length}-component draft`,
    );
  }

  const grams = Math.round(component.grams);
  const lines = [`${component.component} — ${grams} г`];

  if (component.candidates.length === 0) {
    lines.push(correctionCopy.noMatch);
  } else {
    component.candidates.forEach((candidate, i) => {
      const marker = candidate.fdcId === component.chosenFdcId ? ` ${correctionCopy.chosenMarker}` : '';
      lines.push(`${i + 1}. ${candidate.description}${marker}`);
    });
  }

  return lines.join('\n');
}

/** D-05: the post-save card. Final numbers with NO `≈` and no not-saved
 * marker, plus the day the entry was saved to. */
export function buildConfirmedCard(components: DraftComponent[], localDate: string): string {
  const lines: string[] = [];

  for (const component of components) {
    lines.push(...formatComponentBlock(component));
    lines.push('');
  }

  lines.push(formatTotalsBlock(components, { approximate: false }));
  lines.push(correctionCopy.savedOn(localDate));

  return lines.join('\n');
}
