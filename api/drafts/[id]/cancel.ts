/**
 * cancel — POST /api/drafts/[id]/cancel, the D-12 escape hatch for the
 * empty state (every component removed). 04.1-UI-SPEC.md's empty state
 * offers `✕ Отменить разбор` alongside `➕ Добавить`; without this endpoint
 * that button has nothing behind it. Ported from the (now-removed, 04.1-11)
 * chat-native correction handler's cancel case.
 *
 * The `fromStatus` argument to `claimAbandon` is the hardcoded literal
 * `'draft'`, written directly in this file — never taken from the request
 * body (no body is read at all). `claimAbandon` also accepts the OTHER
 * saved-entry status as its fourth argument; accepting a status from the
 * client would turn this unconfirmed-only escape hatch into an unconfirmed
 * delete of a real diary entry with no confirmation step (T-04.1-33b).
 *
 * Both the won and lost claim return an identical 200 { cancelled: true } —
 * distinguishing them would leak whether the draft exists (T-04.1-33c). The
 * lost-race case is still logged via `logApiError`.
 *
 * The response never contains component, transcript, or nutrient data.
 *
 * LOGGING RULE: `logApiError` only — never the request body, component name,
 * or candidate description (health data).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, type Db } from '../../_lib/db';
import { logApiError, parseDraftId, requireUser, sendError } from '../../_lib/http';
import { claimAbandon as claimAbandonReal } from '../../../src/application/draft-store';

export interface CancelDeps {
  getDb: () => Db;
  requireUser: typeof requireUser;
  claimAbandon: typeof claimAbandonReal;
}

export function createCancelHandler(deps: Partial<CancelDeps> = {}) {
  const d: CancelDeps = {
    getDb,
    requireUser,
    claimAbandon: claimAbandonReal,
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
    const claimed = await d.claimAbandon(db, draftId, user.id, 'draft');
    if (!claimed) {
      logApiError('cancel', draftId, 'lost_race');
    }

    res.status(200).json({ cancelled: true });
  };
}

export default createCancelHandler();
