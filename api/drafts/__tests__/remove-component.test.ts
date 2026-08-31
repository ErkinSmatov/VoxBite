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
const { createRemoveComponentHandler } = await import('../[id]/remove-component');

const USER = { id: 7, timezone: 'Asia/Almaty' };

function baseComponent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    component: 'рис',
    componentEn: 'rice',
    grams: 100,
    candidates: [],
    chosenFdcId: 1,
    weakMatch: false,
    ...overrides,
  };
}

describe('createRemoveComponentHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 405 and never calls removeComponent for a non-POST request', async () => {
    const removeComponent = vi.fn();
    const recomputeSavedEntry = vi.fn();
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry,
    });

    const req = makeReq({ method: 'GET' });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(removeComponent).not.toHaveBeenCalled();
  });

  it('responds 401 and never calls removeComponent for missing/invalid initData', async () => {
    vi.mocked(requireUser).mockImplementation(async (_req, res) => {
      res.status(401).json({ error: 'missing_init_data' });
      return null;
    });
    const removeComponent = vi.fn();
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry: vi.fn(),
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { componentIndex: 0 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(removeComponent).not.toHaveBeenCalled();
  });

  it('responds 400 invalid_body for a non-integer/negative/missing componentIndex', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const removeComponent = vi.fn();

    for (const body of [{}, { componentIndex: -1 }, { componentIndex: 1.5 }, { componentIndex: 'zero' }]) {
      const handler = createRemoveComponentHandler({
        db: {} as never,
        removeComponent,
        recomputeSavedEntry: vi.fn(),
      });
      const req = makeReq({ method: 'POST', query: { id: '5' }, body });
      const res = makeRes();

      await handler(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonBody).toEqual({ error: 'invalid_body' });
    }
    expect(removeComponent).not.toHaveBeenCalled();
  });

  it('calls removeComponent exactly once with a valid body', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const removeComponent = vi.fn().mockResolvedValue({ ok: true, components: [baseComponent()] });
    const readDraft = vi.fn().mockResolvedValue({
      id: 5,
      status: 'draft',
      localDate: null,
      diaryId: null,
    });
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry: vi.fn(),
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { componentIndex: 1 } });
    const res = makeRes();

    await handler(req, res);

    expect(removeComponent).toHaveBeenCalledTimes(1);
    expect(removeComponent).toHaveBeenCalledWith({}, 5, USER.id, 1);
  });

  it('removing the last component returns 200 with an empty array, not an error', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const removeComponent = vi.fn().mockResolvedValue({ ok: true, components: [] });
    const readDraft = vi.fn().mockResolvedValue({
      id: 5,
      status: 'draft',
      localDate: null,
      diaryId: null,
    });
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry: vi.fn(),
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { componentIndex: 0 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const jsonBody = res.jsonBody as { components: unknown[]; blockedComponent: unknown };
    expect(jsonBody.components).toEqual([]);
    expect(jsonBody.blockedComponent).toBeNull();
  });

  it('calls recomputeSavedEntry exactly once when the draft is confirmed', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const removeComponent = vi.fn().mockResolvedValue({ ok: true, components: [baseComponent()] });
    const readDraft = vi.fn().mockResolvedValue({
      id: 5,
      status: 'confirmed',
      localDate: '2026-08-31',
      diaryId: 99,
    });
    const recomputeSavedEntry = vi.fn().mockResolvedValue({ ok: true, diaryId: 99 });
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry,
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { componentIndex: 0 } });
    const res = makeRes();

    await handler(req, res);

    expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
    expect(recomputeSavedEntry).toHaveBeenCalledWith({}, 5, USER.id);
  });

  it('does not call recomputeSavedEntry when the draft is a plain draft', async () => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const removeComponent = vi.fn().mockResolvedValue({ ok: true, components: [baseComponent()] });
    const readDraft = vi.fn().mockResolvedValue({
      id: 5,
      status: 'draft',
      localDate: null,
      diaryId: null,
    });
    const recomputeSavedEntry = vi.fn();
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry,
      readDraft,
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { componentIndex: 0 } });
    const res = makeRes();

    await handler(req, res);

    expect(recomputeSavedEntry).not.toHaveBeenCalled();
  });

  const reasonTable: Array<[string, number]> = [
    ['out_of_range', 422],
    ['not_found', 404],
    ['expired', 410],
    ['write_failed', 500],
  ];

  it.each(reasonTable)('maps removeComponent reason %s to status %d', async (reason, status) => {
    vi.mocked(requireUser).mockResolvedValue(USER);
    const removeComponent = vi.fn().mockResolvedValue({ ok: false, reason });
    const handler = createRemoveComponentHandler({
      db: {} as never,
      removeComponent,
      recomputeSavedEntry: vi.fn(),
    });

    const req = makeReq({ method: 'POST', query: { id: '5' }, body: { componentIndex: 0 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(status);
    expect(res.jsonBody).toEqual({ error: reason });
  });
});
