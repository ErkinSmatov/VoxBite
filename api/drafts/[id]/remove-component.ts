/**
 * remove-component — POST /api/drafts/[id]/remove-component
 *
 * CORRECT-05/D-12: removes one component from a draft, including the last
 * remaining one. The empty-list outcome is a legitimate first-class state
 * (the frontend renders the empty-state screen and offers "add"), NOT an
 * error, NOT a 410, and NOT an automatic abandon — mirrors the (now-removed,
 * 04.1-11) chat-native correction handler's remove-component case.
 *
 * Guard, validate body, call `removeComponent`, translate the result — no
 * room to reinvent auth, status codes, or logging here (see `api/_lib/http.ts`).
 *
 * `readDraft` is called AFTER a successful mutation only to learn the
 * draft's `status`/`localDate`/`diaryId` for the response envelope and the
 * `status === 'confirmed' -> recomputeSavedEntry` guard — `removeComponent`
 * itself already re-read and expiry-checked the draft before writing
 * (04-RESEARCH.md's RE-READ RULE), so this second read never gates the
 * mutation itself, only the response shape.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getDb, type Db } from '../../_lib/db.js';
import { requireUser, reasonToStatus, sendError, parseDraftId, logApiError } from '../../_lib/http.js';
import { buildComponentsResponse } from '../../_lib/draft-response.js';
import { readDraft as readDraftReal } from '../../../src/application/draft-store.js';
import { removeComponent as removeComponentReal } from '../../../src/application/corrections.js';
import { recomputeSavedEntry as recomputeSavedEntryReal } from '../../../src/application/confirm-meal.js';

const bodySchema = z.object({
  componentIndex: z.number().int().nonnegative(),
});

export interface RemoveComponentHandlerDeps {
  db: Db;
  /** Injectable overrides for tests — default to the real implementations. */
  removeComponent?: typeof removeComponentReal;
  recomputeSavedEntry?: typeof recomputeSavedEntryReal;
  readDraft?: typeof readDraftReal;
}

export function createRemoveComponentHandler(deps: RemoveComponentHandlerDeps) {
  const removeComponent = deps.removeComponent ?? removeComponentReal;
  const recomputeSavedEntry = deps.recomputeSavedEntry ?? recomputeSavedEntryReal;
  const readDraft = deps.readDraft ?? readDraftReal;

  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed');
      return;
    }

    const user = await requireUser(req, res);
    if (!user) {
      return;
    }

    const draftId = parseDraftId(req.query.id);
    if (draftId === null) {
      sendError(res, 404, 'not_found');
      return;
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'invalid_body');
      return;
    }

    const result = await removeComponent(deps.db, draftId, user.id, parsed.data.componentIndex);
    if (!result.ok) {
      logApiError('remove-component', draftId, result.reason);
      sendError(res, reasonToStatus(result.reason), result.reason);
      return;
    }

    const draft = await readDraft(deps.db, draftId, user.id);
    const status = draft?.status ?? 'draft';
    const localDate = draft?.localDate ?? null;
    const saved = draft !== null && draft.status === 'confirmed' && draft.diaryId !== null;

    if (status === 'confirmed') {
      await recomputeSavedEntry(deps.db, draftId, user.id);
    }

    res.status(200).json(buildComponentsResponse(draftId, status, saved, localDate, result.components));
  };
}

export default function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  return createRemoveComponentHandler({ db: getDb() })(req, res);
}
