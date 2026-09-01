import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes';
import { createGetDraftHandler } from '../[id]';
import type { PersistedDraft } from '../../../src/application/types';

function makeDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    id: 5,
    userId: 7,
    chatId: 100,
    messageId: 200,
    source: 'voice',
    transcript: 'куриная грудка 150 грамм',
    components: [
      {
        component: 'куриная грудка',
        componentEn: 'chicken breast',
        grams: 150,
        candidates: [
          {
            fdcId: 1,
            description: 'Chicken, broilers or fryers, breast, meat only, raw',
            source: 'foundation_food',
            kcal: 120,
            proteinG: 22,
            fatG: 2.5,
            carbsG: 0,
            sugarG: null,
            similarity: 0.9,
          },
        ],
        chosenFdcId: 1,
        weakMatch: false,
      },
    ],
    status: 'draft',
    localDate: '2026-08-31',
    diaryId: null,
    createdAt: new Date('2026-08-31T10:00:00Z'),
    ...overrides,
  };
}

const AUTH_USER = { id: 7, timezone: 'Asia/Almaty' };

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    getDb: vi.fn(() => ({}) as never),
    readDraft: vi.fn(),
    markDraftStatus: vi.fn(),
    requireUser: vi.fn(async () => AUTH_USER),
    now: vi.fn(() => new Date('2026-08-31T12:00:00Z')),
    ...overrides,
  };
}

describe('createGetDraftHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 405 for a non-GET method and never calls requireUser', async () => {
    const deps = makeDeps();
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'POST' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.jsonBody).toEqual({ error: 'method_not_allowed' });
    expect(deps.requireUser).not.toHaveBeenCalled();
  });

  it('returns without calling readDraft when requireUser rejects (missing/invalid initData)', async () => {
    const deps = makeDeps({
      requireUser: vi.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'missing_init_data' });
        return null;
      }),
    });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(deps.readDraft).not.toHaveBeenCalled();
  });

  it('responds 400 invalid_draft_id for a non-numeric id', async () => {
    const deps = makeDeps();
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: 'abc' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'invalid_draft_id' });
    expect(deps.readDraft).not.toHaveBeenCalled();
  });

  it('responds 404 not_found when readDraft returns null', async () => {
    const deps = makeDeps({ readDraft: vi.fn(async () => null) });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toEqual({ error: 'not_found' });
  });

  it('a foreign draft produces the byte-identical 404 body as a nonexistent draft', async () => {
    const deps1 = makeDeps({ readDraft: vi.fn(async () => null) });
    const handler1 = createGetDraftHandler(deps1);
    const req1 = makeReq({ method: 'GET', query: { id: '5' } });
    const res1 = makeRes();
    await handler1(req1, res1);

    const deps2 = makeDeps({ readDraft: vi.fn(async () => null) });
    const handler2 = createGetDraftHandler(deps2);
    const req2 = makeReq({ method: 'GET', query: { id: '999' } });
    const res2 = makeRes();
    await handler2(req2, res2);

    expect(res1.statusCode).toBe(res2.statusCode);
    expect(JSON.stringify(res1.jsonBody)).toBe(JSON.stringify(res2.jsonBody));
  });

  it('responds 410 expired when status is abandoned', async () => {
    const deps = makeDeps({ readDraft: vi.fn(async () => makeDraft({ status: 'abandoned' })) });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(410);
    expect(res.jsonBody).toEqual({ error: 'expired' });
  });

  it('marks a stale draft abandoned exactly once, then responds 410 expired', async () => {
    const deps = makeDeps({
      readDraft: vi.fn(async () =>
        makeDraft({ status: 'draft', createdAt: new Date('2026-08-01T00:00:00Z') }),
      ),
      now: vi.fn(() => new Date('2026-08-31T12:00:00Z')),
    });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(deps.markDraftStatus).toHaveBeenCalledTimes(1);
    expect(deps.markDraftStatus).toHaveBeenCalledWith(expect.anything(), 5, AUTH_USER.id, 'abandoned');
    expect(res.statusCode).toBe(410);
    expect(res.jsonBody).toEqual({ error: 'expired' });
  });

  it('a confirmed draft created 10 days ago is NOT expired and returns 200 with saved: true', async () => {
    const tenDaysAgo = new Date('2026-08-21T12:00:00Z');
    const deps = makeDeps({
      readDraft: vi.fn(async () =>
        makeDraft({ status: 'confirmed', createdAt: tenDaysAgo, diaryId: 42 }),
      ),
      now: vi.fn(() => new Date('2026-08-31T12:00:00Z')),
    });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { saved: boolean }).saved).toBe(true);
  });

  it('a healthy draft returns 200 with the full buildDraftResponse body including candidates and total', async () => {
    const draft = makeDraft();
    const deps = makeDeps({ readDraft: vi.fn(async () => draft) });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as {
      draftId: number;
      components: Array<{ candidates: unknown[] }>;
      total: unknown;
    };
    expect(body.draftId).toBe(5);
    expect(body.components[0]?.candidates).toEqual(draft.components[0]?.candidates);
    expect(body.total).toBeDefined();
  });

  it('always calls readDraft with (db, draftId, user.id), never a request-supplied user id', async () => {
    const draft = makeDraft();
    const deps = makeDeps({ readDraft: vi.fn(async () => draft) });
    const handler = createGetDraftHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(deps.readDraft).toHaveBeenCalledWith(expect.anything(), 5, AUTH_USER.id);
  });
});
