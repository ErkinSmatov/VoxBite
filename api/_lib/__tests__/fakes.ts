/**
 * fakes — minimal `VercelRequest`/`VercelResponse` fakes shared by every
 * `api/**` test in this phase (04.1-03 through 04.1-07), mirroring how
 * `src/bot/handlers/correction.test.ts`'s `makeCtx` fakes a grammY `Context`
 * rather than booting a real one. No endpoint test should invent its own.
 *
 * Named `fakes.ts` (not `fakes.test.ts`) so Vitest's `api/**\/*.test.ts`
 * include glob does not pick this file up as a test file itself.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface FakeRes extends VercelResponse {
  statusCode: number | null;
  jsonBody: unknown;
  ended: boolean;
}

export function makeReq(
  opts: {
    method?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | string[]>;
    body?: unknown;
  } = {},
): VercelRequest {
  return {
    method: opts.method ?? 'GET',
    headers: opts.headers ?? {},
    query: opts.query ?? {},
    body: opts.body,
    cookies: {},
  } as unknown as VercelRequest;
}

export function makeRes(): FakeRes {
  const res = {
    statusCode: null,
    jsonBody: undefined,
    ended: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.jsonBody = body;
      return res;
    },
    send(body: unknown) {
      res.jsonBody = body;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  } as unknown as FakeRes;
  return res;
}
