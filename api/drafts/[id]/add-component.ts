/**
 * add-component — POST /api/drafts/[id]/add-component
 *
 * CORRECT-06: appends a user-typed missing component to a draft, matched
 * through the SAME `matchIngredient()` path (and the SAME embedding model)
 * `src/application/corrections.ts`'s `addComponent` already implements —
 * this endpoint runs no matching of its own (04.1-RESEARCH.md's Don't
 * Hand-Roll table).
 *
 * This is the only endpoint in this phase that spends money (one OpenAI
 * embedding call per invocation). The paid call sits behind two gates,
 * both of which run BEFORE `getMatchingDeps`/`addComponent` are ever
 * reached: `requireUser` (a validated, fresh `initData` for an onboarded
 * user), and the zod `max(MAX_COMPONENT_TEXT_LENGTH)` schema (rejecting an
 * oversized payload before it can reach the paid call, defence in depth on
 * top of `addComponent`'s own internal bound).
 *
 * `raw` is passed to `addComponent` verbatim (untrimmed) — this endpoint
 * does not translate, normalise, or pre-process the typed text.
 *
 * `readDraft` is called AFTER a successful mutation only to learn the
 * draft's `status`/`localDate`/`diaryId` for the response envelope and the
 * `status === 'confirmed' -> recomputeSavedEntry` guard, mirroring
 * `remove-component.ts` — `addComponent` itself already re-read and
 * expiry-checked the draft before writing.
 *
 * LOGGING RULE: `logApiError` takes only operation + draft id + reason —
 * never the typed text.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { getDb, type Db } from '../../_lib/db';
import { requireUser, reasonToStatus, sendError, parseDraftId, logApiError } from '../../_lib/http';
import { buildComponentsResponse } from '../../_lib/draft-response';
import { getMatchingDeps as getMatchingDepsReal } from '../../_lib/matching';
import { readDraft as readDraftReal } from '../../../src/application/draft-store';
import { addComponent as addComponentReal, MAX_COMPONENT_TEXT_LENGTH } from '../../../src/application/corrections';
import { recomputeSavedEntry as recomputeSavedEntryReal } from '../../../src/application/confirm-meal';

const bodySchema = z.object({
  raw: z.string().min(1).max(MAX_COMPONENT_TEXT_LENGTH),
});

export interface AddComponentHandlerDeps {
  db: Db;
  /** Injectable overrides for tests — default to the real implementations. */
  addComponent?: typeof addComponentReal;
  recomputeSavedEntry?: typeof recomputeSavedEntryReal;
  readDraft?: typeof readDraftReal;
  getMatchingDeps?: typeof getMatchingDepsReal;
}

export function createAddComponentHandler(deps: AddComponentHandlerDeps) {
  const addComponent = deps.addComponent ?? addComponentReal;
  const recomputeSavedEntry = deps.recomputeSavedEntry ?? recomputeSavedEntryReal;
  const readDraft = deps.readDraft ?? readDraftReal;
  const getMatchingDeps = deps.getMatchingDeps ?? getMatchingDepsReal;

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

    const { embedder, repo } = getMatchingDeps(deps.db);
    const result = await addComponent(deps.db, draftId, user.id, parsed.data.raw, { embedder, repo });
    if (!result.ok) {
      logApiError('add-component', draftId, result.reason);
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
  return createAddComponentHandler({ db: getDb() })(req, res);
}
