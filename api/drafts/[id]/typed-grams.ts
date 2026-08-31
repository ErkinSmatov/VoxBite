/**
 * typed-grams — POST /api/drafts/[id]/typed-grams, the HTTP port for
 * CORRECT-04's typed-exact-gram-value path. Thin translation of
 * `src/application/corrections.ts`'s `applyTypedGrams` — no correction
 * logic lives here.
 *
 * This endpoint MUST NOT parse, trim, round, or bounds-check the gram
 * string itself. The one gram-string parser is a private helper inside
 * `src/application/corrections.ts`'s `applyTypedGrams` — the single parser
 * for this value across the whole product (04-RESEARCH.md's Don't
 * Hand-Roll entry) — it already enforces the comma-decimal tolerance, the
 * optional trailing unit, the rounding rule and the MIN/MAX bounds. The
 * only thing validated here is that `raw` is a string of a sane length —
 * an input-validation concern, not a parsing concern.
 *
 * RECOMPUTE GUARD: same as `swap-candidate.ts`/`adjust-grams.ts` — when the
 * draft is already `status === 'confirmed'`, the saved `diary` row must be
 * recomputed after the mutation via `recomputeSavedEntry` (04-UAT.md rounds
 * 3-4 / CR-02).
 *
 * LOGGING RULE: `logApiError` only — never the raw gram string.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { buildDraftResponse } from '../../_lib/draft-response';
import { getDb, type Db } from '../../_lib/db';
import { logApiError, parseDraftId, reasonToStatus, requireUser, sendError } from '../../_lib/http';
import { recomputeSavedEntry as recomputeSavedEntryReal } from '../../../src/application/confirm-meal';
import { applyTypedGrams as applyTypedGramsReal } from '../../../src/application/corrections';
import { readDraft as readDraftReal } from '../../../src/application/draft-store';

/** A gram value is never longer than this — bounds a megabyte-payload attempt, nothing more. */
const MAX_RAW_LENGTH = 32;

const Body = z.object({
  componentIndex: z.number().int().nonnegative(),
  raw: z.string().max(MAX_RAW_LENGTH),
});

export interface TypedGramsDeps {
  getDb: () => Db;
  requireUser: typeof requireUser;
  applyTypedGrams: typeof applyTypedGramsReal;
  readDraft: typeof readDraftReal;
  recomputeSavedEntry: typeof recomputeSavedEntryReal;
  now: () => Date;
}

export function createTypedGramsHandler(deps: Partial<TypedGramsDeps> = {}) {
  const d: TypedGramsDeps = {
    getDb,
    requireUser,
    applyTypedGrams: applyTypedGramsReal,
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
    const result = await d.applyTypedGrams(db, draftId, user.id, body.data.componentIndex, body.data.raw, d.now());

    if (!result.ok) {
      logApiError('typed-grams', draftId, result.reason);
      sendError(res, reasonToStatus(result.reason), result.reason);
      return;
    }

    const draft = await d.readDraft(db, draftId, user.id);
    if (!draft) {
      logApiError('typed-grams', draftId, 'not_found');
      sendError(res, 404, 'not_found');
      return;
    }

    if (draft.status === 'confirmed') {
      const recomputed = await d.recomputeSavedEntry(db, draftId, user.id);
      if (!recomputed.ok) {
        logApiError('typed-grams', draftId, recomputed.reason);
      }
    }

    res.status(200).json(buildDraftResponse(draft));
  };
}

export default createTypedGramsHandler();
