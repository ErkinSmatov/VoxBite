import { describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes';
import type { Db } from '../../_lib/db';
import { createTypedGramsHandler } from '../[id]/typed-grams';
import type { DraftComponent, PersistedDraft } from '../../../src/application/types';

const FIXED_NOW = new Date('2026-08-31T12:00:00Z');

function makeComponent(overrides: Partial<DraftComponent> = {}): DraftComponent {
  return {
    component: 'курица',
    componentEn: 'chicken',
    grams: 150,
    candidates: [],
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

describe('POST /api/drafts/[id]/typed-grams', () => {
  it('returns 400 invalid_body when raw exceeds the max length', async () => {
    const applyTypedGrams = vi.fn();
    const handler = createTypedGramsHandler({ getDb: fakeGetDb, applyTypedGrams, requireUser: successRequireUser() });
    const req = makeReq({
      method: 'POST',
      query: { id: '42' },
      body: { componentIndex: 0, raw: '1'.repeat(33) },
    });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'invalid_body' });
    expect(applyTypedGrams).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_body when componentIndex is missing', async () => {
    const applyTypedGrams = vi.fn();
    const handler = createTypedGramsHandler({ getDb: fakeGetDb, applyTypedGrams, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { raw: '200' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(applyTypedGrams).not.toHaveBeenCalled();
  });

  it.each(['200', '200 г', '200,5'])('passes raw value %s to applyTypedGrams verbatim, untrimmed and unparsed', async (raw) => {
    const draft = makeDraft();
    const applyTypedGrams = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const handler = createTypedGramsHandler({
      getDb: fakeGetDb,
      applyTypedGrams,
      readDraft,
      requireUser: successRequireUser(),
      now: () => FIXED_NOW,
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, raw } });
    const res = makeRes();

    await handler(req, res);

    expect(applyTypedGrams).toHaveBeenCalledWith({}, 42, 7, 0, raw, FIXED_NOW);
  });

  it('returns 422 invalid_grams and does not write when applyTypedGrams rejects the text', async () => {
    const applyTypedGrams = vi.fn(async () => ({ ok: false as const, reason: 'invalid_grams' as const }));
    const handler = createTypedGramsHandler({ getDb: fakeGetDb, applyTypedGrams, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, raw: 'not a number' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({ error: 'invalid_grams' });
    expect(applyTypedGrams).toHaveBeenCalledTimes(1);
  });

  it('calls recomputeSavedEntry exactly once when the draft is already confirmed', async () => {
    const draft = makeDraft({ status: 'confirmed', diaryId: 99 });
    const applyTypedGrams = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const handler = createTypedGramsHandler({
      getDb: fakeGetDb,
      applyTypedGrams,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, raw: '200' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['out_of_range', 422],
    ['not_found', 404],
    ['expired', 410],
    ['write_failed', 500],
  ] as const)('maps applyTypedGrams reason %s to status %i', async (reason, status) => {
    const applyTypedGrams = vi.fn(async () => ({ ok: false as const, reason }));
    const handler = createTypedGramsHandler({ getDb: fakeGetDb, applyTypedGrams, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, raw: '200' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
  });
});
