import { describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes';
import type { Db } from '../../_lib/db';
import { createRecomputeHandler } from '../[id]/recompute';
import type { DraftComponent, PersistedDraft } from '../../../src/application/types';

const FIXED_NOW = new Date('2026-08-31T12:00:00Z');

function makeCandidate(fdcId: number): DraftComponent['candidates'][number] {
  return {
    fdcId,
    description: `Candidate ${fdcId}`,
    source: 'foundation_food',
    kcal: 100,
    proteinG: 10,
    fatG: 5,
    carbsG: 20,
    sugarG: 1,
    similarity: 0.9,
  };
}

function makeComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  return {
    component: 'курица',
    componentEn: 'chicken',
    grams: 150,
    candidates: [makeCandidate(1)],
    chosenFdcId: 1,
    weakMatch: false,
    ...overrides,
  };
}

function makeDraft(overrides: Partial<PersistedDraft> = {}): PersistedDraft {
  return {
    id: 42,
    userId: 7,
    chatId: 100,
    messageId: 200,
    source: 'voice',
    transcript: 'курица 150г',
    components: [makeComponent()],
    status: 'confirmed',
    localDate: '2026-08-30',
    diaryId: 99,
    createdAt: FIXED_NOW,
    ...overrides,
  };
}

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

describe('POST /api/drafts/[id]/recompute', () => {
  it('returns 405 for a non-POST method and never calls recomputeSavedEntry', async () => {
    const recomputeSavedEntry = vi.fn();
    const handler = createRecomputeHandler({ getDb: fakeGetDb, recomputeSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'GET', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(recomputeSavedEntry).not.toHaveBeenCalled();
  });

  it('returns 401 for missing/invalid initData and never calls recomputeSavedEntry', async () => {
    const recomputeSavedEntry = vi.fn();
    const handler = createRecomputeHandler({
      getDb: fakeGetDb,
      recomputeSavedEntry,
      requireUser: rejectingRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(recomputeSavedEntry).not.toHaveBeenCalled();
  });

  it('calls recomputeSavedEntry exactly once with (db, draftId, user.id)', async () => {
    const draft = makeDraft();
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const readDraft = vi.fn(async () => draft);
    const handler = createRecomputeHandler({
      getDb: fakeGetDb,
      recomputeSavedEntry,
      readDraft,
      requireUser: successRequireUser(),
      now: () => FIXED_NOW,
    });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
    expect(recomputeSavedEntry.mock.calls[0]?.slice(1, 3)).toEqual([42, 7]);
  });

  it('does not read the request body', async () => {
    const draft = makeDraft();
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const readDraft = vi.fn(async () => draft);
    const handler = createRecomputeHandler({
      getDb: fakeGetDb,
      recomputeSavedEntry,
      readDraft,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { anything: 'ignored' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('ok:true returns 200 with a DraftResponse whose saved is true and total reflects the current components', async () => {
    const draft = makeDraft();
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const readDraft = vi.fn(async () => draft);
    const handler = createRecomputeHandler({
      getDb: fakeGetDb,
      recomputeSavedEntry,
      readDraft,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { saved: boolean; total: { kcal: number | null } };
    expect(body.saved).toBe(true);
    expect(body.total.kcal).not.toBeNull();
  });

  it("reason: 'not_saved' returns 409 { error: 'not_saved' }", async () => {
    const recomputeSavedEntry = vi.fn(async () => ({ ok: false as const, reason: 'not_saved' as const }));
    const handler = createRecomputeHandler({ getDb: fakeGetDb, recomputeSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.jsonBody).toEqual({ error: 'not_saved' });
  });

  it("reason: 'blocked' returns 422 with error and blockedComponent", async () => {
    const recomputeSavedEntry = vi.fn(async () => ({
      ok: false as const,
      reason: 'blocked' as const,
      blockedComponent: 'курица',
    }));
    const handler = createRecomputeHandler({ getDb: fakeGetDb, recomputeSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({ error: 'blocked', blockedComponent: 'курица' });
  });

  it("reason: 'not_found' returns 404", async () => {
    const recomputeSavedEntry = vi.fn(async () => ({ ok: false as const, reason: 'not_found' as const }));
    const handler = createRecomputeHandler({ getDb: fakeGetDb, recomputeSavedEntry, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody).toEqual({ error: 'not_found' });
  });

  it("the response's localDate equals the draft's stored value; the handler never overrides the date", async () => {
    const draft = makeDraft({ localDate: '2026-08-15' });
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const readDraft = vi.fn(async () => draft);
    const handler = createRecomputeHandler({
      getDb: fakeGetDb,
      recomputeSavedEntry,
      readDraft,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' } });
    const res = makeRes();

    await handler(req, res);

    const body = res.jsonBody as { localDate: string | null };
    expect(body.localDate).toBe('2026-08-15');
  });
});
