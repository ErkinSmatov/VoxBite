/**
 * Authenticated fetch wrapper for the Mini App's own `/api/*` endpoints.
 *
 * Every request attaches `Authorization: tma <initData>` — the raw, signed
 * initData string is the ONLY credential this client ever sends (see
 * telegram.ts's header comment and 04.1-RESEARCH.md Pattern 1). This module
 * never reads or forwards a client-asserted identity field; the server
 * resolves who is calling entirely from the validated initData string.
 *
 * Requests go to relative paths (e.g. `/api/drafts/123`) — the SPA and the
 * API are the same Vercel deployment, so there is no base URL and no CORS
 * preflight involved.
 */

import { getRawInitData } from './telegram';
import type { ApiErrorCode } from '../types';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'api'; status: number; code: ApiErrorCode; blockedComponent?: string }
  | { ok: false; kind: 'network' };

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `tma ${getRawInitData()}`,
  };
}

interface ApiErrorBody {
  error?: string;
  blockedComponent?: string;
}

async function toResult<T>(res: Response): Promise<ApiResult<T>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Response was not JSON at all (e.g. an upstream 502 HTML page) — treat
    // as a transport-level failure, not a structured API failure.
    return { ok: false, kind: 'network' };
  }

  if (!res.ok) {
    const errorBody = body as ApiErrorBody;
    const code = (errorBody.error ?? 'invalid_body') as ApiErrorCode;
    const result: ApiResult<T> = {
      ok: false,
      kind: 'api',
      status: res.status,
      code,
    };
    if (errorBody.blockedComponent !== undefined) {
      result.blockedComponent = errorBody.blockedComponent;
    }
    return result;
  }

  return { ok: true, data: body as T };
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'GET',
      headers: authHeaders(),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }
  return toResult<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: authHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }
  return toResult<T>(res);
}
