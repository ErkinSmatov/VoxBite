import { describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes.js';
import type { Db } from '../../_lib/db.js';
import { createAdjustGramsHandler } from '../[id]/adjust-grams.js';
import { GRAM_STEP, MAX_GRAMS } from '../../../src/application/corrections.js';
import type { DraftComponent, PersistedDraft } from '../../../src/application/types.js';

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

describe('POST /api/drafts/[id]/adjust-grams', () => {
  it('returns 400 invalid_body for an unrecognized direction', async () => {
    const adjustGrams = vi.fn();
    const handler = createAdjustGramsHandler({ getDb: fakeGetDb, adjustGrams, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'sideways' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({ error: 'invalid_body' });
    expect(adjustGrams).not.toHaveBeenCalled();
  });

  it("calls adjustGrams with +GRAM_STEP for direction 'up'", async () => {
    const draft = makeDraft();
    const adjustGrams = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const handler = createAdjustGramsHandler({
      getDb: fakeGetDb,
      adjustGrams,
      readDraft,
      requireUser: successRequireUser(),
      now: () => FIXED_NOW,
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'up' } });
    const res = makeRes();

    await handler(req, res);

    expect(adjustGrams).toHaveBeenCalledWith({}, 42, 7, 0, GRAM_STEP, FIXED_NOW);
  });

  it("calls adjustGrams with -GRAM_STEP for direction 'down'", async () => {
    const draft = makeDraft();
    const adjustGrams = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const handler = createAdjustGramsHandler({
      getDb: fakeGetDb,
      adjustGrams,
      readDraft,
      requireUser: successRequireUser(),
      now: () => FIXED_NOW,
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'down' } });
    const res = makeRes();

    await handler(req, res);

    expect(adjustGrams).toHaveBeenCalledWith({}, 42, 7, 0, -GRAM_STEP, FIXED_NOW);
  });

  it('returns 400 for a client-supplied delta field (direction still required)', async () => {
    const adjustGrams = vi.fn();
    const handler = createAdjustGramsHandler({ getDb: fakeGetDb, adjustGrams, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, delta: 999 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(adjustGrams).not.toHaveBeenCalled();
  });

  it('calls recomputeSavedEntry exactly once when the draft is already confirmed', async () => {
    const draft = makeDraft({ status: 'confirmed', diaryId: 99 });
    const adjustGrams = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
    const handler = createAdjustGramsHandler({
      getDb: fakeGetDb,
      adjustGrams,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'up' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
  });

  it('does not call recomputeSavedEntry on a plain (non-confirmed) draft', async () => {
    const draft = makeDraft({ status: 'draft' });
    const adjustGrams = vi.fn(async () => ({ ok: true as const, components: draft.components }));
    const readDraft = vi.fn(async () => draft);
    const recomputeSavedEntry = vi.fn();
    const handler = createAdjustGramsHandler({
      getDb: fakeGetDb,
      adjustGrams,
      readDraft,
      recomputeSavedEntry,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'up' } });
    const res = makeRes();

    await handler(req, res);

    expect(recomputeSavedEntry).not.toHaveBeenCalled();
  });

  it('returns 200 with grams unchanged when the component is already at MAX_GRAMS', async () => {
    const clampedComponent = makeComponent({ grams: MAX_GRAMS });
    const draft = makeDraft({ components: [clampedComponent] });
    const adjustGrams = vi.fn(async () => ({ ok: true as const, components: [clampedComponent] }));
    const readDraft = vi.fn(async () => draft);
    const handler = createAdjustGramsHandler({
      getDb: fakeGetDb,
      adjustGrams,
      readDraft,
      requireUser: successRequireUser(),
    });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'up' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as { components: DraftComponent[] };
    expect(body.components[0]?.grams).toBe(MAX_GRAMS);
  });

  it.each([
    ['out_of_range', 422],
    ['not_found', 404],
    ['expired', 410],
    ['write_failed', 500],
  ] as const)('maps adjustGrams reason %s to status %i', async (reason, status) => {
    const adjustGrams = vi.fn(async () => ({ ok: false as const, reason }));
    const handler = createAdjustGramsHandler({ getDb: fakeGetDb, adjustGrams, requireUser: successRequireUser() });
    const req = makeReq({ method: 'POST', query: { id: '42' }, body: { componentIndex: 0, direction: 'up' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
  });
});
