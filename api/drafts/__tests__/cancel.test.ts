import { describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes.js';
import type { Db } from '../../_lib/db.js';
import { createCancelHandler } from '../[id]/cancel.js';

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

describe('POST /api/drafts/[id]/cancel', () => {
  it('returns 405 for a non-POST method and never calls claimAbandon', async () => {
    const claimAbandon = vi.fn();
    const handler = createCancelHandler({ getDb: fakeGetDb, claimAbandon, requireUser: successRequireUser() });
    const req = makeReq({ method: 'GET', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(claimAbandon).not.toHaveBeenCalled();
  });

  it('returns 401 for missing/invalid initData and never calls claimAbandon', async () => {
    const claimAbandon = vi.fn();
    const handler = createCancelHandler({
      getDb: fakeGetDb,
      claimAbandon,
      requireUser: rejectingRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(claimAbandon).not.toHaveBeenCalled();
  });

  it("calls claimAbandon(db, draftId, user.id, 'draft') exactly once", async () => {
    const claimAbandon = vi.fn(async () => true);
    const handler = createCancelHandler({ getDb: fakeGetDb, claimAbandon, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { ignored: 'field' } });
    const res = makeRes();

    await handler(req, res);

    expect(claimAbandon).toHaveBeenCalledTimes(1);
    expect(claimAbandon.mock.calls[0]?.slice(1, 4)).toEqual([42, 7, 'draft']);
  });

  it('returns 200 { cancelled: true } when claimAbandon returns true', async () => {
    const claimAbandon = vi.fn(async () => true);
    const handler = createCancelHandler({ getDb: fakeGetDb, claimAbandon, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ cancelled: true });
  });

  it('returns 200 { cancelled: true } even when claimAbandon returns false (lost race)', async () => {
    const claimAbandon = vi.fn(async () => false);
    const handler = createCancelHandler({ getDb: fakeGetDb, claimAbandon, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ cancelled: true });
  });

  it('never includes component, transcript, or nutrient data in the response', async () => {
    const claimAbandon = vi.fn(async () => true);
    const handler = createCancelHandler({ getDb: fakeGetDb, claimAbandon, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(Object.keys(res.jsonBody as object)).toEqual(['cancelled']);
  });
});
