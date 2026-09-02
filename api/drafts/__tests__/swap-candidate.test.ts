import { describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes.js';
import type { Db } from '../../_lib/db.js';
import { createSwapCandidateHandler } from '../[id]/swap-candidate.js';
import type { DraftComponent, PersistedDraft } from '../../../src/application/types.js';

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
    candidates: [makeCandidate(1), makeCandidate(2), makeCandidate(3)],
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
    status: 'draft',
    localDate: '2026-08-31',
    diaryId: null,
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

function fakeGetDb(): Db {
  return {} as Db;
}

function rejectingRequireUser() {
  return vi.fn(async (_req, res) => {
    res.status(401).json({ error: 'missing_init_data' });
    return null;
  });
}

describe('POST /api/drafts/[id]/swap-candidate', () => {
  it('returns 405 for a non-POST method and never calls swapCandidate', async () => {
    const swapCandidate = vi.fn();
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb, swapCandidate, requireUser: successRequireUser() });
    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(swapCandidate).not.toHaveBeenCalled();
  });

  it('returns 401 for missing/invalid initData and never calls swapCandidate', async () => {
    const swapCandidate = vi.fn();
    const requireUser = rejectingRequireUser();
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb, swapCandidate, requireUser });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, candidateIndex: 1 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(swapCandidate).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_body for a malformed body and never calls swapCandidate', async () => {
    const swapCandidate = vi.fn();
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb, swapCandidate, requireUser: successRequireUser() });
    const req = makeReq({
      method: 'POST',
      query: { id: '42' },
      body: { componentIndex: -1, candidateIndex: 'zero' },
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'invalid_body' });
    expect(swapCandidate).not.toHaveBeenCalled();
  });

  it('calls swapCandidate exactly once with the validated values in order', async () => {
    const draft = makeDraft();
    const swapCandidate = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn();
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb,
      swapCandidate,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
      now: () => FIXED_NOW,
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, candidateIndex: 2 } });
    const res = makeRes();

    await handler(req, res);

    expect(swapCandidate).toHaveBeenCalledTimes(1);
    expect(swapCandidate.mock.calls[0]?.slice(1, 5)).toEqual([42, 7, 0, 2]);
  });

  it('returns 200 with a DraftResponse when the draft status is "draft", without recomputing', async () => {
    const draft = makeDraft({ status: 'draft' });
    const swapCandidate = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn();
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb,
      swapCandidate,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, candidateIndex: 1 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(recomputeSavedEntry).not.toHaveBeenCalled();
    expect((res.jsonBody as { status: string }).status).toBe('draft');
  });

  it('calls recomputeSavedEntry exactly once when the draft is already confirmed', async () => {
    const draft = makeDraft({ status: 'confirmed', diaryId: 99 });
    const swapCandidate = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb,
      swapCandidate,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, candidateIndex: 1 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 with a non-null blockedComponent when recompute reports blocked', async () => {
    const blockedComponent = makeComponent({ chosenFdcId: null, candidates: [] });
    const draft = makeDraft({ status: 'confirmed', diaryId: 99, components: [blockedComponent] });
    const swapCandidate = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn(async () => ({
      ok: false as const,
      reason: 'blocked' as const,
      blockedComponent: blockedComponent.component,
    }));
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb,
      swapCandidate,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, candidateIndex: 1 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as { blockedComponent: string | null }).blockedComponent).not.toBeNull();
  });

  it.each([
    ['out_of_range', 422],
    ['not_found', 404],
    ['expired', 410],
    ['write_failed', 500],
  ] as const)('maps swapCandidate reason %s to status %i', async (reason, status) => {
    const swapCandidate = vi.fn(async () => ({ ok: false as const, reason }));
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb, swapCandidate, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, candidateIndex: 1 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
  });

  it('never echoes the raw request body back in the response', async () => {
    const draft = makeDraft();
    const swapCandidate = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const handler = createSwapCandidateHandler({ getDb: fakeGetDb,
      swapCandidate,
      readDraft,
      requireUser: successRequireUser(),
    });
    const body = { componentIndex: 0, candidateIndex: 1, secretMarker: 'do-not-echo' };
    const req = makeReq({ method: 'POST', query: { id: '42' }, body });
    const res = makeRes();

    await handler(req, res);

    expect(JSON.stringify(res.jsonBody)).not.toContain('secretMarker');
    expect(JSON.stringify(res.jsonBody)).not.toContain('do-not-echo');
  });
});
