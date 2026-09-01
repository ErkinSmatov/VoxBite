/**
 * GET /api/drafts/[id] — loads one draft, scoped to the validated caller, for
 * the Mini App's correction screen (CORRECT-01). Reproduces the (now-removed,
 * 04.1-11) chat-native correction handler's identity -> scoped read ->
 * status/expiry gate sequence as HTTP status codes instead of
 * `editMessageText` redraws — see 04.1-PATTERNS.md's "api/drafts/[id].ts"
 * section.
 *
 * IDOR RULE (preserved from `draft-store.ts`): a foreign draft and a
 * nonexistent one both produce the byte-identical 404 `{ error: 'not_found' }`
 * body — `readDraft` already collapses the two cases, and this handler must
 * never add a different status/body that lets a caller tell them apart.
 *
 * `getDb()` is resolved inside the handler body (never at module scope) so
 * importing this module in a test never opens a socket.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb, type Db } from '../_lib/db';
import { logApiError, parseDraftId, requireUser, sendError } from '../_lib/http';
import { buildDraftResponse } from '../_lib/draft-response';
import { markDraftStatus, readDraft } from '../../src/application/draft-store';
import { isDraftExpired } from '../../src/application/types';

export interface GetDraftDeps {
  getDb: () => Db;
  readDraft: typeof readDraft;
  markDraftStatus: typeof markDraftStatus;
  requireUser: typeof requireUser;
  now: () => Date;
}

export function createGetDraftHandler(deps: Partial<GetDraftDeps> = {}) {
  const d: GetDraftDeps = {
    getDb,
    readDraft,
    markDraftStatus,
    requireUser,
    now: () => new Date(),
    ...deps,
  };

  return async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
    if (req.method !== 'GET') {
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
    const draft = await d.readDraft(db, draftId, user.id);
    if (!draft) {
      logApiError('get-draft', draftId, 'not_found');
      sendError(res, 404, 'not_found');
      return;
    }

    if (draft.status === 'abandoned') {
      sendError(res, 410, 'expired');
      return;
    }

    if (isDraftExpired(draft.status, draft.createdAt, d.now())) {
      await d.markDraftStatus(db, draftId, user.id, 'abandoned');
      sendError(res, 410, 'expired');
      return;
    }

    res.status(200).json(buildDraftResponse(draft));
  };
}

export default createGetDraftHandler();
