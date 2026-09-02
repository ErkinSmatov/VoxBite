/**
 * recompute — POST /api/drafts/[id]/recompute, the CORRECT-08 explicit save
 * path for a reopened, already-saved diary entry. Thin translation of
 * `src/application/confirm-meal.ts`'s `recomputeSavedEntry` — no correction
 * logic lives here.
 *
 * WHY THIS ENDPOINT EXISTS EVEN THOUGH EVERY MUTATION ENDPOINT ALREADY CALLS
 * recomputeSavedEntry: the five mutation endpoints (plans 05/06) already
 * re-save the diary row automatically after each individual change to a
 * confirmed draft, so the diary is never stale between taps. This endpoint
 * is the EXPLICIT `Сохранить изменения` action 04.1-UI-SPEC.md requires on
 * the reopened-saved-entry footer — it re-runs the blocked check one more
 * time and gives the frontend a definitive "your edits are saved" answer
 * before it closes the Mini App.
 *
 * D-07: `recomputeSavedEntry` never touches `localDate` — this handler never
 * computes, passes, or overrides a date either. No request body is read.
 *
 * LOGGING RULE: `logApiError` only — never the request body, component name,
 * or candidate description (health data).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { buildDraftResponse } from '../../_lib/draft-response.js';
import { getDb, type Db } from '../../_lib/db.js';
import { logApiError, parseDraftId, requireUser, sendError } from '../../_lib/http.js';
import { recomputeSavedEntry as recomputeSavedEntryReal } from '../../../src/application/confirm-meal.js';
import { readDraft as readDraftReal } from '../../../src/application/draft-store.js';

export interface RecomputeDeps {
  getDb: () => Db;
  requireUser: typeof requireUser;
  recomputeSavedEntry: typeof recomputeSavedEntryReal;
  readDraft: typeof readDraftReal;
  now: () => Date;
}

export function createRecomputeHandler(deps: Partial<RecomputeDeps> = {}) {
  const d: RecomputeDeps = {
    getDb,
    requireUser,
    recomputeSavedEntry: recomputeSavedEntryReal,
    readDraft: readDraftReal,
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

    const draftId = parseDraftId(req.query.id);
    if (draftId === null) {
      sendError(res, 400, 'invalid_draft_id');
      return;
    }

    const db = d.getDb();
    const result = await d.recomputeSavedEntry(db, draftId, user.id);

    if (!result.ok) {
      logApiError('recompute', draftId, result.reason);
      if (result.reason === 'blocked') {
        res.status(422).json({ error: 'blocked', blockedComponent: result.blockedComponent ?? '' });
        return;
      }
      sendError(res, result.reason === 'not_saved' ? 409 : 404, result.reason);
      return;
    }

    const draft = await d.readDraft(db, draftId, user.id);
    if (!draft) {
      logApiError('recompute', draftId, 'not_found');
      sendError(res, 404, 'not_found');
      return;
    }

    res.status(200).json(buildDraftResponse(draft));
  };
}

export default createRecomputeHandler();
