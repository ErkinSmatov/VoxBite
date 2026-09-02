/**
 * swap-candidate — POST /api/drafts/[id]/swap-candidate, the HTTP port for
 * CORRECT-03: swap a component's matched FDC candidate for one of its other
 * two candidates. Thin translation of `src/application/corrections.ts`'s
 * `swapCandidate` — no correction logic lives here.
 *
 * RECOMPUTE GUARD (the one thing this file must never drop, per 04-UAT.md
 * rounds 3-4 / CR-02): when the draft being corrected is already
 * `status === 'confirmed'` (i.e. already saved to the diary), the saved
 * `diary` row must be recomputed after the mutation via
 * `recomputeSavedEntry`, exactly like the (now-removed, 04.1-11) chat-native
 * correction handler's candidate-swap case did. Porting to HTTP without
 * carrying this guard across would silently desync the diary from the draft.
 *
 * LOGGING RULE: `logApiError` only — never the request body, component name,
 * or candidate description (health data).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { buildDraftResponse } from '../../_lib/draft-response.js';
import { getDb, type Db } from '../../_lib/db.js';
import { logApiError, parseDraftId, reasonToStatus, requireUser, sendError } from '../../_lib/http.js';
import { recomputeSavedEntry as recomputeSavedEntryReal } from '../../../src/application/confirm-meal.js';
import { readDraft as readDraftReal } from '../../../src/application/draft-store.js';
import { swapCandidate as swapCandidateReal } from '../../../src/application/corrections.js';

const Body = z.object({
  componentIndex: z.number().int().nonnegative(),
  candidateIndex: z.number().int().nonnegative(),
});

export interface SwapCandidateDeps {
  getDb: () => Db;
  requireUser: typeof requireUser;
  swapCandidate: typeof swapCandidateReal;
  readDraft: typeof readDraftReal;
  recomputeSavedEntry: typeof recomputeSavedEntryReal;
  now: () => Date;
}

export function createSwapCandidateHandler(deps: Partial<SwapCandidateDeps> = {}) {
  const d: SwapCandidateDeps = {
    getDb,
    requireUser,
    swapCandidate: swapCandidateReal,
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

    const db = d.getDb();
    const result = await d.swapCandidate(
      db,
      draftId,
      user.id,
      body.data.componentIndex,
      body.data.candidateIndex,
      d.now(),
    );

    if (!result.ok) {
      logApiError('swap-candidate', draftId, result.reason);
      sendError(res, reasonToStatus(result.reason), result.reason);
      return;
    }

    const draft = await d.readDraft(db, draftId, user.id);
    if (!draft) {
      logApiError('swap-candidate', draftId, 'not_found');
      sendError(res, 404, 'not_found');
      return;
    }

    if (draft.status === 'confirmed') {
      const recomputed = await d.recomputeSavedEntry(db, draftId, user.id);
      if (!recomputed.ok) {
        logApiError('swap-candidate', draftId, recomputed.reason);
      }
    }

    res.status(200).json(buildDraftResponse(draft));
  };
}

export default createSwapCandidateHandler();
