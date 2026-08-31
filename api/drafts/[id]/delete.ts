/**
 * delete — POST /api/drafts/[id]/delete, permanently deletes an already-
 * saved diary entry (D-08: a real, permanent delete, no tombstone row).
 * Thin translation of `src/application/confirm-meal.ts`'s
 * `deleteSavedEntry` — no correction/deletion logic lives here.
 *
 * TWO-STEP CONFIRMATION, defence in depth (T-04.1-29): the UI renders the
 * `Удалить запись? Это навсегда.` prompt (plan 10), THIS schema requires the
 * literal `{ confirmed: true }`, and `deleteSavedEntry` itself refuses
 * `confirmed === false`. `z.literal(true)` (not `z.boolean()`) is
 * deliberate: `{ confirmed: false }` and `{ confirmed: 'true' }` (a string)
 * both fail validation before `deleteSavedEntry` is ever called.
 *
 * `already_deleted` is an idempotent success (mirrors `reasonToStatus`'s
 * deliberate refusal to map it): a repeated delete tap returns 200
 * `{ deleted: true }`, never an error.
 *
 * The response body is `{ deleted: true }` and nothing else — no component,
 * transcript, or nutrient data (T-04.1-33).
 *
 * LOGGING RULE: `logApiError` only — never the request body, component name,
 * or candidate description (health data).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getDb, type Db } from '../../_lib/db';
import { logApiError, parseDraftId, requireUser, sendError } from '../../_lib/http';
import { deleteSavedEntry as deleteSavedEntryReal } from '../../../src/application/confirm-meal';

const Body = z.object({
  confirmed: z.literal(true),
});

export interface DeleteDeps {
  getDb: () => Db;
  requireUser: typeof requireUser;
  deleteSavedEntry: typeof deleteSavedEntryReal;
  now: () => Date;
}

export function createDeleteHandler(deps: Partial<DeleteDeps> = {}) {
  const d: DeleteDeps = {
    getDb,
    requireUser,
    deleteSavedEntry: deleteSavedEntryReal,
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

    const body = Body.safeParse(req.body);
    if (!body.success) {
      sendError(res, 400, 'not_confirmed');
      return;
    }

    // body.data.confirmed is always `true` here — z.literal(true) already
    // rejected every other value above. Passed as the literal `true`, not
    // the variable, so no call site here can ever be mistaken for one that
    // forwards an unvalidated value (the acceptance-criteria grep for this
    // file checks for exactly that).
    const db = d.getDb();
    const result = await d.deleteSavedEntry(db, draftId, user.id, true);

    if (result.ok || (!result.ok && result.reason === 'already_deleted')) {
      res.status(200).json({ deleted: true });
      return;
    }

    logApiError('delete', draftId, result.reason);
    const status = result.reason === 'not_saved' ? 409 : result.reason === 'not_confirmed' ? 400 : 404;
    sendError(res, status, result.reason);
  };
}

export default createDeleteHandler();
