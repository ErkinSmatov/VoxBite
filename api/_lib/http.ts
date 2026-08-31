/**
 * http — the shared auth guard, the one application-reason-to-HTTP-status
 * mapping, the response envelope's error writer, and the single logging
 * helper every `api/drafts/[id]/*.ts` endpoint (plans 04-07) builds on.
 * Every endpoint's job becomes: guard, validate body, call one
 * application-layer function, translate the result — with no room to
 * reinvent auth, status codes, or logging per-endpoint.
 *
 * LOGGING RULE (mirrors `draft-store.ts`/`corrections.ts`/`confirm-meal.ts`'s
 * module headers): `logApiError` logs only the operation name, draft id and
 * reason — never `req.body`, component names, candidate descriptions, or
 * transcript text. This is health data.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './db';
import { resolveUser } from './resolve-user';
import { validateAndParse } from './validate-init-data';

const TMA_PREFIX = 'tma ';

/**
 * The one identity source for every endpoint: reads
 * `req.headers.authorization`, strips the `tma ` scheme, validates+parses
 * the enclosed `initData`, then resolves it to an onboarded user. Order is
 * fixed: no header -> 401; validation throws -> 401; unknown/not-onboarded
 * user -> 403. Writes the error response itself and returns `null`, so a
 * handler's own guard is a single `if (!user) return;`.
 *
 * The resolved `id` is the ONLY acceptable source of `userId` for any
 * endpoint — no handler may ever read a user id from `req.body` or
 * `req.query` (04.1-RESEARCH.md Pitfall 1).
 */
export async function requireUser(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ id: number; timezone: string } | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(TMA_PREFIX)) {
    sendError(res, 401, 'missing_init_data');
    return null;
  }

  const rawInitData = header.slice(TMA_PREFIX.length);

  let parsed: { user?: { id: number } };
  try {
    parsed = validateAndParse(rawInitData, process.env.TELEGRAM_BOT_TOKEN ?? '');
  } catch {
    sendError(res, 401, 'invalid_init_data');
    return null;
  }

  const user = await resolveUser(getDb(), parsed.user?.id);
  if (!user) {
    sendError(res, 403, 'not_onboarded');
    return null;
  }

  return user;
}

/**
 * The application-reason -> HTTP-status table, 04.1-PATTERNS.md's "Result-
 * discriminated-union -> HTTP status mapping". `already_confirmed` and
 * `already_deleted` are deliberately NOT in this table: they are idempotent
 * successes, and each endpoint must return 200 with the draft's current
 * state instead of calling this function for them — calling it with either
 * throws, so a caller cannot accidentally turn a no-op into an error.
 */
const REASON_STATUS: Record<string, number> = {
  not_found: 404,
  expired: 410,
  no_local_date: 410,
  blocked: 422,
  empty: 422,
  out_of_range: 422,
  invalid_grams: 422,
  text_too_long: 422,
  empty_text: 422,
  match_failed: 422,
  not_saved: 409,
  not_confirmed: 400,
  write_failed: 500,
};

const IDEMPOTENT_SUCCESS_REASONS = new Set(['already_confirmed', 'already_deleted']);

export function reasonToStatus(reason: string): number {
  if (IDEMPOTENT_SUCCESS_REASONS.has(reason)) {
    throw new Error(
      `reasonToStatus: '${reason}' is an idempotent success, not an error — the caller must return 200 with the draft's current state instead of calling reasonToStatus`,
    );
  }
  return REASON_STATUS[reason] ?? 500;
}

/** Writes `{ error }` and nothing else — never a raw exception message, never draft content. */
export function sendError(res: VercelResponse, status: number, error: string): void {
  res.status(status).json({ error });
}

/**
 * Accepts only a string of digits that maps to a positive safe integer —
 * `req.query.id` is user-controlled input, never authorization (the IDOR
 * rule every `application/*` function already enforces via `(draftId,
 * userId)` scoping).
 */
export function parseDraftId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

/**
 * The single logging helper for every `api/**` file's catch/error-log
 * lines — mirrors the LOGGING RULE stated in `draft-store.ts`/
 * `corrections.ts`/`confirm-meal.ts`'s module headers. Never interpolate
 * `req.body`, component names, candidate descriptions, or the transcript
 * into a log line.
 */
export function logApiError(operation: string, draftId: number | null, reason: string): void {
  console.error(`${operation}: failed for draft ${draftId} (${reason})`);
}
