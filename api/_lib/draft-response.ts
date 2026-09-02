/**
 * draft-response — the single response envelope every `api/drafts/[id]/*.ts`
 * endpoint (plans 04-07) returns. `mini-app/src/types.ts` (plan 08) mirrors
 * the `DraftResponse` interface below by hand — this file is the source of
 * truth for that mirror.
 *
 * Totals come from `summarizeDraft` (`src/application/draft-totals.ts`,
 * plan 03 task 1) and from nowhere else — no endpoint file may build its own
 * `TotalInputItem[]` or sum nutrients (CALC-01).
 */
import { findBlockingComponent } from '../../src/application/confirm-meal.js';
import { summarizeDraft } from '../../src/application/draft-totals.js';
import type { DraftComponent, PersistedDraft } from '../../src/application/types.js';
import type { NutrientTotal } from '../../src/domain/nutrition/index.js';

export interface DraftResponse {
  draftId: number;
  status: 'draft' | 'confirmed' | 'abandoned';
  saved: boolean;
  localDate: string | null;
  components: DraftComponent[];
  total: NutrientTotal;
  contributingCount: number;
  blockedComponent: string | null;
}

/** The one private builder both public functions funnel through — exactly one envelope shape. */
function build(
  draftId: number,
  status: 'draft' | 'confirmed' | 'abandoned',
  saved: boolean,
  localDate: string | null,
  components: DraftComponent[],
): DraftResponse {
  const { total, contributingCount } = summarizeDraft(components);
  return {
    draftId,
    status,
    saved,
    localDate,
    components,
    total,
    contributingCount,
    blockedComponent: findBlockingComponent(components)?.component ?? null,
  };
}

/**
 * Builds a `DraftResponse` from a freshly `readDraft`-ed row. `saved` is
 * `true` only when `status === 'confirmed'` AND `diaryId !== null`.
 */
export function buildDraftResponse(draft: PersistedDraft): DraftResponse {
  const saved = draft.status === 'confirmed' && draft.diaryId !== null;
  return build(draft.id, draft.status, saved, draft.localDate, draft.components);
}

/**
 * The form for endpoints that already hold the freshly mutated `components`
 * array returned by a `corrections.ts` function and should not re-read the
 * row. Callers pass `saved`/`status`/`localDate` directly since they already
 * know them from the draft they just mutated.
 */
export function buildComponentsResponse(
  draftId: number,
  status: 'draft' | 'confirmed' | 'abandoned',
  saved: boolean,
  localDate: string | null,
  components: DraftComponent[],
): DraftResponse {
  return build(draftId, status, saved, localDate, components);
}
