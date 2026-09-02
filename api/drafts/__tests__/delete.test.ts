import { describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes.js';
import type { Db } from '../../_lib/db.js';
import { createDeleteHandler } from '../[id]/delete.js';

const FIXED_NOW = new Date('2026-08-31T12:00:00Z');

function makeUser() {
  return { id: 7, timezone: 'Asia/Almaty' };
}

function successRequireUser(user = makeUser()) {
  return vi.fn(async () => user);
}

function rejectingRequireUser() {
  return vi.fn(async (_req, res) => {
    res.status(401).json({ error: 'missing_init_data' });
    return null;
  });
}

function fakeGetDb(): Db {
  return {} as Db;
}

describe('POST /api/drafts/[id]/delete', () => {
  it('returns 405 for a non-POST method and never calls deleteSavedEntry', async () => {
    const deleteSavedEntry = vi.fn();
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'GET', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(deleteSavedEntry).not.toHaveBeenCalled();
  });

  it('returns 405 for a DELETE method too (POST-only)', async () => {
    const deleteSavedEntry = vi.fn();
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'DELETE', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(deleteSavedEntry).not.toHaveBeenCalled();
  });

  it('returns 401 for missing/invalid initData and never calls deleteSavedEntry', async () => {
    const deleteSavedEntry = vi.fn();
    const handler = createDeleteHandler({
      getDb: fakeGetDb,
      deleteSavedEntry,
      requireUser: rejectingRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(deleteSavedEntry).not.toHaveBeenCalled();
  });

  it.each([
    ['missing body', undefined],
    ['empty body', {}],
    ['confirmed: false', { confirmed: false }],
    ["confirmed: 'true' (string)", { confirmed: 'true' }],
  ])('returns 400 not_confirmed for %s and never calls deleteSavedEntry with confirmed: true', async (_label, body) => {
    const deleteSavedEntry = vi.fn();
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'not_confirmed' });
    expect(deleteSavedEntry).not.toHaveBeenCalled();
  });

  it('calls deleteSavedEntry(db, draftId, user.id, true) exactly once for { confirmed: true }', async () => {
    const deleteSavedEntry = vi.fn(async () => ({ ok: true as const }));
    const handler = createDeleteHandler({
      getDb: fakeGetDb,
      deleteSavedEntry,
      requireUser: successRequireUser(),
      now: () => FIXED_NOW,
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(deleteSavedEntry).toHaveBeenCalledTimes(1);
    expect(deleteSavedEntry.mock.calls[0]?.slice(1, 4)).toEqual([42, 7, true]);
  });

  it('ok: true returns 200 { deleted: true }', async () => {
    const deleteSavedEntry = vi.fn(async () => ({ ok: true as const }));
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ deleted: true });
  });

  it("reason: 'already_deleted' returns 200 { deleted: true }, not an error", async () => {
    const deleteSavedEntry = vi.fn(async () => ({ ok: false as const, reason: 'already_deleted' as const }));
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ deleted: true });
  });

  it.each([
    ['not_saved', 409],
    ['not_found', 404],
  ] as const)("reason: '%s' returns %i", async (reason, status) => {
    const deleteSavedEntry = vi.fn(async () => ({ ok: false as const, reason }));
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
    expect(res.jsonBody).toEqual({ error: reason });
  });

  it('never includes component, transcript, or nutrient data in the response', async () => {
    const deleteSavedEntry = vi.fn(async () => ({ ok: true as const }));
    const handler = createDeleteHandler({ getDb: fakeGetDb, deleteSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { confirmed: true } });
    const res = makeRes();

    await handler(req, res);

    expect(Object.keys(res.jsonBody as object)).toEqual(['deleted']);
  });
});
