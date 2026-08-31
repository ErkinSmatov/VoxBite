import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes';

vi.mock('../../_lib/http', async () => {
  const actual = await vi.importActual<typeof import('../../_lib/http')>('../../_lib/http');
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

const { requireUser } = await import('../../_lib/http');
const { createAddComponentHandler } = await import('../[id]/add-component');

const USER = { id: 7, timezone: 'Asia/Almaty' };

function newComponent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    component: 'сметана',
    componentEn: 'сметана',
    grams: 100,
    candidates: [
      {
        fdcId: 1,
        description: 'Sour cream',
        source: 'sr_legacy_food' as const,
        kcal: 100,
        proteinG: 2,
        fatG: 20,
        carbsG: 3,
        sugarG: null,
        similarity: 0.9,
      },
    ],
    chosenFdcId: 1,
    weakMatch: false,
    ...overrides,
  };
}

function makeFakeEmbedder() {
  return { embed: vi.fn().mockResolvedValue([[0.1, 0.2]]) };
}

describe('createAddComponentHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 405 and makes no embedding call for a non-POST request', async () => {
    const addComponent = vi.fn();
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry: vi.fn(),
      getMatchingDeps,
    });

    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(addComponent).not.toHaveBeenCalled();
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it('responds 401 and makes no embedding call for missing/invalid initData', async () => {
    vi.mocked(requireUser).mockImplementation(async (_req, res) => {
      res.status(401).json({ error: 'missing_init_data' });
      return null;
    });
    const addComponent = vi.fn();
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry: vi.fn(),
      getMatchingDeps,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { raw: 'сметана' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(addComponent).not.toHaveBeenCalled();
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it('responds 400 invalid_body and makes no embedding call for a bad raw field', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const addComponent = vi.fn();

    for (const body of [{}, { raw: '' }, { raw: 123 }, { raw: 'x'.repeat(101) }]) {
      const embedder = makeFakeEmbedder();
      const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
      const handler = createAddComponentHandler({
        db: {} as never,
        addComponent,
        recomputeSavedEntry: vi.fn(),
        getMatchingDeps,
      });
      const req = makeReq({ method: 'POST', query: { id: '5' }, body });
      const res = makeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonBody).toEqual({ error: 'invalid_body' });
      expect(embedder.embed).not.toHaveBeenCalled();
    }
    expect(addComponent).not.toHaveBeenCalled();
  });

  it('reaches addComponent with raw passed verbatim (untrimmed) and calls the embedder once', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const addComponent = vi.fn(async (_db, _draftId, _userId, raw, deps) => {
      await deps.embedder.embed([raw]);
      return { ok: true as const, components: [newComponent()] };
    });
    const readDraft = vi.fn().mockResolvedValue({ id: 5, status: 'draft', localDate: null, diaryId: null });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry: vi.fn(),
      getMatchingDeps,
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { raw: ' сметана ' } });
    const res = makeRes();

    await handler(req, res);

    expect(addComponent).toHaveBeenCalledTimes(1);
    expect(addComponent).toHaveBeenCalledWith({}, 5, USER.id, ' сметана ', { embedder, repo: {} });
    expect(embedder.embed).toHaveBeenCalledTimes(1);
  });

  const rejectReasons: Array<[string, number]> = [
    ['empty_text', 422],
    ['text_too_long', 422],
    ['match_failed', 422],
  ];

  it.each(rejectReasons)('maps addComponent reason %s to status %d', async (reason, status) => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const addComponent = vi.fn().mockResolvedValue({ ok: false, reason });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry: vi.fn(),
      getMatchingDeps,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { raw: 'сметана' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
    if (reason === 'match_failed') {
      expect(res.jsonBody).toEqual({ error: 'match_failed' });
    }
  });

  it('responds 200 with a DraftResponse containing the new component on success', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const added = newComponent();
    const addComponent = vi.fn().mockResolvedValue({ ok: true, components: [added] });
    const readDraft = vi.fn().mockResolvedValue({ id: 5, status: 'draft', localDate: null, diaryId: null });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry: vi.fn(),
      getMatchingDeps,
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { raw: 'сметана' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const jsonBody = res.jsonBody as { components: unknown[] };
    expect(jsonBody.components).toEqual([added]);
  });

  it('calls recomputeSavedEntry exactly once when the draft is confirmed', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const addComponent = vi.fn().mockResolvedValue({ ok: true, components: [newComponent()] });
    const readDraft = vi.fn().mockResolvedValue({ id: 5, status: 'confirmed', localDate: '2026-08-31', diaryId: 99 });
    const recomputeSavedEntry = vi.fn().mockResolvedValue({ ok: true, diaryId: 99 });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry,
      getMatchingDeps,
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { raw: 'сметана' } });
    const res = makeRes();

    await handler(req, res);

    expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
    expect(recomputeSavedEntry).toHaveBeenCalledWith({}, 5, USER.id);
  });

  const notFoundTable: Array<[string, number]> = [
    ['not_found', 404],
    ['expired', 410],
    ['write_failed', 500],
  ];

  it.each(notFoundTable)('maps addComponent reason %s to status %d', async (reason, status) => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const embedder = makeFakeEmbedder();
    const getMatchingDeps = vi.fn().mockReturnValue({ embedder, repo: {} });
    const addComponent = vi.fn().mockResolvedValue({ ok: false, reason });
    const handler = createAddComponentHandler({
      db: {} as never,
      addComponent,
      recomputeSavedEntry: vi.fn(),
      getMatchingDeps,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { raw: 'сметана' } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
  });
});
