/**
 * draft-totals — the preview-total item-building rule, extracted out of
 * `src/bot/formatting/correction-card.ts`'s `formatTotalsBlock` so the Mini
 * App API (this phase) does not duplicate it.
 *
 * This is the ONLY place outside `confirm-meal.ts` that builds
 * `TotalInputItem[]` from a `DraftComponent[]` — it exists so the Mini App
 * API never writes a second summation (CALC-01/D-03).
 * `correction-card.ts`'s duplicate copy of this exact rule is deleted in
 * plan 11 of this phase; until then a temporary duplicate exists between
 * this plan and that one — do not let a third copy appear anywhere else.
 *
 * `src/application/` rules apply: no grammY import, no DB driver import, no
 * `@vercel/node` type import — this file may only import `src/domain/**`
 * and `src/application/**`.
 *
 * Rounding: `calculateTotal` returns raw, unrounded floats and this file
 * never rounds anything — rounding happens at render time only, in the
 * Mini App frontend, exactly as `correction-card.ts` did.
 */
import { calculateTotal } from '../domain/nutrition/index.js';
import type { NutrientTotal, TotalInputItem } from '../domain/nutrition/index.js';
import type { DraftComponent } from './types.js';

/**
 * Builds the `TotalInputItem[]` for a draft's current components: a
 * component with no chosen candidate (`chosenFdcId === null`), or whose
 * chosen id is not present in its own `candidates` array (a corrupted jsonb
 * row), contributes no item. A component with a valid chosen candidate
 * contributes exactly one item carrying that component's `grams` and the
 * chosen candidate's nutrient values verbatim, `null`s included.
 */
export function toPreviewTotalItems(components: DraftComponent[]): TotalInputItem[] {
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

  return items;
}

/**
 * `total` is exactly `calculateTotal(toPreviewTotalItems(components))` and
 * `contributingCount` is `toPreviewTotalItems(components).length` — the
 * single summary shape every Mini App API response builds its `total` and
 * `contributingCount` fields from (see `api/_lib/draft-response.ts`).
 */
export function summarizeDraft(components: DraftComponent[]): {
  total: NutrientTotal;
  contributingCount: number;
} {
  const items = toPreviewTotalItems(components);
  return { total: calculateTotal(items), contributingCount: items.length };
}
