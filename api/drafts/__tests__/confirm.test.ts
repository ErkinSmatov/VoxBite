import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes.js';
import { createConfirmHandler } from '../[id]/confirm.js';
import type { PersistedDraft } from '../../../src/application/types.js';
import type { ConfirmMealResult } from '../../../src/application/confirm-meal.js';

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
    status: 'confirmed',
    localDate: '2026-08-31',
    diaryId: 42,
    createdAt: new Date('2026-08-31T10:00:00Z'),
    ...overrides,
  };
}

const AUTH_USER = { id: 7, timezone: 'Asia/Almaty' };

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    getDb: vi.fn(() => ({}) as never),
    confirmMeal: vi.fn(),
    readDraft: vi.fn(),
    requireUser: vi.fn(async () => AUTH_USER),
    now: vi.fn(() => new Date('2026-08-31T12:00:00Z')),
    ...overrides,
  };
}

describe('createConfirmHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 405 for a non-POST method and never calls confirmMeal', async () => {
    const deps = makeDeps();
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'GET', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(deps.confirmMeal).not.toHaveBeenCalled();
  });

  it('returns without calling confirmMeal when requireUser rejects (missing/invalid initData)', async () => {
    const deps = makeDeps({
      requireUser: vi.fn(async (_req: unknown, res: { status: (c: number) => { json: (b: unknown) => void } }) => {
        res.status(401).json({ error: 'missing_init_data' });
        return null;
      }),
    });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(deps.confirmMeal).not.toHaveBeenCalled();
  });

  it('responds 200 with a confirmed DraftResponse when confirmMeal succeeds', async () => {
    const okResult: ConfirmMealResult = {
      ok: true,
      diaryId: 42,
      localDate: '2026-08-31',
      components: makeDraft().components,
    };
    const deps = makeDeps({ confirmMeal: vi.fn(async () => okResult) });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { status: string; saved: boolean; localDate: string; components: unknown[] };
    expect(body.status).toBe('confirmed');
    expect(body.saved).toBe(true);
    expect(body.localDate).toBe('2026-08-31');
    expect(body.components).toEqual(okResult.components);
  });

  it('responds 422 blocked with the blockedComponent name', async () => {
    const blockedResult: ConfirmMealResult = { ok: false, reason: 'blocked', blockedComponent: 'куриная грудка' };
    const deps = makeDeps({ confirmMeal: vi.fn(async () => blockedResult) });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({ error: 'blocked', blockedComponent: 'куриная грудка' });
  });

  it('responds 422 empty', async () => {
    const emptyResult: ConfirmMealResult = { ok: false, reason: 'empty' };
    const deps = makeDeps({ confirmMeal: vi.fn(async () => emptyResult) });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({ error: 'empty' });
  });

  it('already_confirmed re-reads the draft and returns 200 with its current state (idempotent)', async () => {
    const alreadyConfirmed: ConfirmMealResult = { ok: false, reason: 'already_confirmed' };
    const fresh = makeDraft();
    const deps = makeDeps({
      confirmMeal: vi.fn(async () => alreadyConfirmed),
      readDraft: vi.fn(async () => fresh),
    });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { status: string };
    expect(body.status).toBe('confirmed');
    expect(deps.readDraft).toHaveBeenCalledWith(expect.anything(), 5, AUTH_USER.id);
  });

  it('already_confirmed followed by a null re-read responds 410 expired instead of crashing', async () => {
    const alreadyConfirmed: ConfirmMealResult = { ok: false, reason: 'already_confirmed' };
    const deps = makeDeps({
      confirmMeal: vi.fn(async () => alreadyConfirmed),
      readDraft: vi.fn(async () => null),
    });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(410);
    expect(res.jsonBody).toEqual({ error: 'expired' });
  });

  it.each([
    ['not_found', 404],
    ['expired', 410],
    ['no_local_date', 410],
    ['write_failed', 500],
  ] as const)('maps reason %s to status %i', async (reason, status) => {
    const result: ConfirmMealResult = { ok: false, reason };
    const deps = makeDeps({ confirmMeal: vi.fn(async () => result) });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
  });

  it('calls confirmMeal exactly once per request with (db, draftId, user.id)', async () => {
    const okResult: ConfirmMealResult = {
      ok: true,
      diaryId: 42,
      localDate: '2026-08-31',
      components: makeDraft().components,
    };
    const deps = makeDeps({ confirmMeal: vi.fn(async () => okResult) });
    const handler = createConfirmHandler(deps);
    const req = makeReq({ method: 'POST', query: { id: '5' } });
    const res = makeRes();

    await handler(req, res);

    expect(deps.confirmMeal).toHaveBeenCalledTimes(1);
    expect(deps.confirmMeal).toHaveBeenCalledWith(expect.anything(), 5, AUTH_USER.id, expect.any(Date));
  });

  it('confirming twice in sequence calls confirmMeal twice but produces exactly one ok:true and one idempotent 200', async () => {
    const okResult: ConfirmMealResult = {
      ok: true,
      diaryId: 42,
      localDate: '2026-08-31',
      components: makeDraft().components,
    };
    const alreadyConfirmed: ConfirmMealResult = { ok: false, reason: 'already_confirmed' };
    const confirmMeal = vi.fn().mockResolvedValueOnce(okResult).mockResolvedValueOnce(alreadyConfirmed);
    const deps = makeDeps({ confirmMeal, readDraft: vi.fn(async () => makeDraft()) });
    const handler = createConfirmHandler(deps);

    const req1 = makeReq({ method: 'POST', query: { id: '5' } });
    const res1 = makeRes();
    await handler(req1, res1);

    const req2 = makeReq({ method: 'POST', query: { id: '5' } });
    const res2 = makeRes();
    await handler(req2, res2);

    expect(confirmMeal).toHaveBeenCalledTimes(2);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
  });
});
