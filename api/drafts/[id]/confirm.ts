/**
 * POST /api/drafts/[id]/confirm — turns a confirmed draft into exactly one
 * `diary` row (CORRECT-02, DIARY-01). Reproduces the (now-removed, 04.1-11)
 * chat-native correction handler's confirm case as HTTP status codes instead
 * of card redraws — see 04.1-PATTERNS.md's "api/drafts/[id]/confirm.ts"
 * section.
 *
 * No request body: confirm takes no parameters beyond the draft id in the
 * path. The server confirms whatever is currently persisted; nothing here
 * computes or adjusts nutrient values — `confirmMeal` already summed the
 * total and wrote the diary row, and the response's `total` comes from
 * `buildComponentsResponse`/`buildDraftResponse`, which call `summarizeDraft`
 * on the same components (CALC-01).
 *
 * `already_confirmed` is an idempotent success (mirrors
 * `reasonToStatus`'s deliberate refusal to map it): re-read the draft and
 * return 200 with its current state rather than an error, so tapping confirm
 * twice is harmless (DIARY-01: never two diary rows).
 *
 * `getDb()` is resolved inside the handler body (never at module scope) so
 * importing this module in a test never opens a socket.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, type Db } from '../../_lib/db.js';
import { logApiError, parseDraftId, reasonToStatus, requireUser, sendError } from '../../_lib/http.js';
import { buildComponentsResponse, buildDraftResponse } from '../../_lib/draft-response.js';
import { readDraft } from '../../../src/application/draft-store.js';
import { confirmMeal } from '../../../src/application/confirm-meal.js';

export interface ConfirmDeps {
  getDb: () => Db;
  confirmMeal: typeof confirmMeal;
  readDraft: typeof readDraft;
  requireUser: typeof requireUser;
  now: () => Date;
}

export function createConfirmHandler(deps: Partial<ConfirmDeps> = {}) {
  const d: ConfirmDeps = {
    getDb,
    confirmMeal,
    readDraft,
    requireUser,
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
    const result = await d.confirmMeal(db, draftId, user.id, d.now());

    if (result.ok) {
      res
        .status(200)
        .json(buildComponentsResponse(draftId, 'confirmed', true, result.localDate, result.components));
      return;
    }

    if (result.reason === 'blocked') {
      res.status(422).json({ error: 'blocked', blockedComponent: result.blockedComponent ?? '' });
      return;
    }

    if (result.reason === 'already_confirmed') {
      const fresh = await d.readDraft(db, draftId, user.id);
      if (!fresh) {
        sendError(res, 410, 'expired');
        return;
      }
      res.status(200).json(buildDraftResponse(fresh));
      return;
    }

    logApiError('confirm', draftId, result.reason);
    sendError(res, reasonToStatus(result.reason), result.reason);
  };
}

export default createConfirmHandler();
