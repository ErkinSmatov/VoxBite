/**
 * Hand-kept mirror of the Mini App API's response shapes.
 *
 * Source of truth (do NOT import from here — `mini-app/` has its own
 * tsconfig and build, separate from the root `src/`/`api/` build, per
 * 04.1-RESEARCH.md Open Question #1):
 * - `api/_lib/draft-response.ts` — the `DraftResponse` envelope itself.
 * - `src/application/types.ts` — the `DraftComponent` shape.
 * - `src/domain/fdc-matching/types.ts` — the `FdcCandidate` shape.
 * - `src/domain/nutrition/calculate-total.ts` — the `NutrientTotal` shape.
 *
 * This is a DELIBERATE hand-kept mirror, not generated. If a field is added
 * or renamed on the server side, it must be added/renamed here too — there
 * is no build-time check that keeps these in sync.
 */

export interface FdcCandidate {
  fdcId: number;
  description: string;
  source: 'foundation_food' | 'sr_legacy_food';
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  similarity: number;
}

export interface DraftComponent {
  component: string;
  componentEn: string;
  grams: number;
  candidates: FdcCandidate[];
  chosenFdcId: number | null;
  weakMatch: boolean;
}

export interface NutrientTotal {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  missingCount: Record<'kcal' | 'proteinG' | 'fatG' | 'carbsG' | 'sugarG', number>;
}

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

/**
 * Every error code any `/api/drafts/*` endpoint can return in its JSON
 * body's `error` field (see api/_lib/http.ts's `reasonToStatus` and
 * api/_lib/validate-init-data.ts / resolve-user.ts for the auth-boundary
 * codes). Kept as one union so `api-client.ts`'s discriminated result type
 * and `App.tsx`'s copy-mapping switch can never silently miss a case.
 */
export type ApiErrorCode =
  | 'missing_init_data'
  | 'invalid_init_data'
  | 'not_onboarded'
  | 'invalid_draft_id'
  | 'not_found'
  | 'expired'
  | 'invalid_body'
  | 'blocked'
  | 'empty'
  | 'out_of_range'
  | 'invalid_grams'
  | 'text_too_long'
  | 'empty_text'
  | 'match_failed'
  | 'not_saved'
  | 'not_confirmed'
  | 'method_not_allowed';
