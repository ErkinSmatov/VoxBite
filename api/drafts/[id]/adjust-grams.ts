/**
 * adjust-grams — POST /api/drafts/[id]/adjust-grams, the HTTP port for
 * CORRECT-04's `±GRAM_STEP г` buttons. Thin translation of
 * `src/application/corrections.ts`'s `adjustGrams` — no correction logic
 * lives here.
 *
 * The delta is derived SERVER-SIDE from `GRAM_STEP`. The client sends only a
 * `direction: 'up' | 'down'`, never a number of grams — letting the client
 * name the delta would create a second place the step size lives, and would
 * let a crafted request jump grams arbitrarily in a single tap.
 *
 * RECOMPUTE GUARD: same as `swap-candidate.ts` — when the draft is already
 * `status === 'confirmed'`, the saved `diary` row must be recomputed after
 * the mutation via `recomputeSavedEntry` (04-UAT.md rounds 3-4 / CR-02).
 *
 * LOGGING RULE: `logApiError` only — never the request body or component name.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { buildDraftResponse } from '../../_lib/draft-response.js';
import { getDb, type Db } from '../../_lib/db.js';
import { logApiError, parseDraftId, reasonToStatus, requireUser, sendError } from '../../_lib/http.js';
import { recomputeSavedEntry as recomputeSavedEntryReal } from '../../../src/application/confirm-meal.js';
import { adjustGrams as adjustGramsReal, GRAM_STEP } from '../../../src/application/corrections.js';
import { readDraft as readDraftReal } from '../../../src/application/draft-store.js';

const Body = z.object({
  componentIndex: z.number().int().nonnegative(),
  direction: z.enum(['up', 'down']),
});

export interface AdjustGramsDeps {
  getDb: () => Db;
  requireUser: typeof requireUser;
  adjustGrams: typeof adjustGramsReal;
  readDraft: typeof readDraftReal;
  recomputeSavedEntry: typeof recomputeSavedEntryReal;
  now: () => Date;
}

export function createAdjustGramsHandler(deps: Partial<AdjustGramsDeps> = {}) {
  const d: AdjustGramsDeps = {
    getDb,
    requireUser,
    adjustGrams: adjustGramsReal,
    readDraft: readDraftReal,
    recomputeSavedEntry: recomputeSavedEntryReal,
    now: () => new Date(),
    ...deps,
  };

  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed');
      return;
    }

    const user = await d.requireUser(req, res);
    if (!user) {
      return;
    }

    const body = Body.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, 'invalid_body');
      return;
    }

    const draftId = parseDraftId(req.query.id);
    if (draftId === null) {
      sendError(res, 400, 'invalid_draft_id');
      return;
    }

    const delta = body.data.direction === 'up' ? GRAM_STEP : -GRAM_STEP;

    const db = d.getDb();
    const result = await d.adjustGrams(db, draftId, user.id, body.data.componentIndex, delta, d.now());

    if (!result.ok) {
      logApiError('adjust-grams', draftId, result.reason);
      sendError(res, reasonToStatus(result.reason), result.reason);
      return;
    }

    const draft = await d.readDraft(db, draftId, user.id);
    if (!draft) {
      logApiError('adjust-grams', draftId, 'not_found');
      sendError(res, 404, 'not_found');
      return;
    }

    if (draft.status === 'confirmed') {
      const recomputed = await d.recomputeSavedEntry(db, draftId, user.id);
      if (!recomputed.ok) {
        logApiError('adjust-grams', draftId, recomputed.reason);
      }
    }

    res.status(200).json(buildDraftResponse(draft));
  };
}

export default createAdjustGramsHandler();
