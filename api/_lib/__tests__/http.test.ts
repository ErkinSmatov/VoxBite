import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from './fakes';

vi.mock('../validate-init-data', () => ({
  validateAndParse: vi.fn(),
}));
vi.mock('../resolve-user', () => ({
  resolveUser: vi.fn(),
}));
vi.mock('../db', () => ({
  getDb: vi.fn(() => ({})),
}));

const { requireUser, reasonToStatus, sendError, parseDraftId, logApiError } = await import('../http');
const { validateAndParse } = await import('../validate-init-data');
const { resolveUser } = await import('../resolve-user');

describe('requireUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds 401 missing_init_data and returns null when no Authorization header is present', async () => {
    const req = makeReq();
    const res = makeRes();

    const result = await requireUser(req, res);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toEqual({ error: 'missing_init_data' });
    expect(validateAndParse).not.toHaveBeenCalled();
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('responds 401 missing_init_data when Authorization is present but not prefixed "tma "', async () => {
    const req = makeReq({ headers: { authorization: 'Bearer abc' } });
    const res = makeRes();

    const result = await requireUser(req, res);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toEqual({ error: 'missing_init_data' });
    expect(validateAndParse).not.toHaveBeenCalled();
  });

  it('responds 401 invalid_init_data when "tma <garbage>" fails validation', async () => {
    vi.mocked(validateAndParse).mockImplementation(() => {
      throw new Error('bad signature');
    });
    const req = makeReq({ headers: { authorization: 'tma garbage' } });
    const res = makeRes();

    const result = await requireUser(req, res);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(401);
    expect(res.jsonBody).toEqual({ error: 'invalid_init_data' });
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('responds 403 not_onboarded for valid initData whose user has no onboarded row', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(validateAndParse).mockReturnValue({ user: { id: 42 } } as any);
    vi.mocked(resolveUser).mockResolvedValue(null);
    const req = makeReq({ headers: { authorization: 'tma valid' } });
    const res = makeRes();

    const result = await requireUser(req, res);

    expect(result).toBeNull();
    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toEqual({ error: 'not_onboarded' });
  });

  it('returns { id, timezone } and writes no response for a valid initData for an onboarded user', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(validateAndParse).mockReturnValue({ user: { id: 42 } } as any);
    vi.mocked(resolveUser).mockResolvedValue({ id: 7, timezone: 'Asia/Almaty' });
    const req = makeReq({ headers: { authorization: 'tma valid' } });
    const res = makeRes();

    const result = await requireUser(req, res);

    expect(result).toEqual({ id: 7, timezone: 'Asia/Almaty' });
    expect(res.statusCode).toBe(0); // sentinel for "not yet set" — no response was written
    expect(res.jsonBody).toBeUndefined();
  });
});

describe('reasonToStatus', () => {
  const table: Array<[string, number]> = [
    ['not_found', 404],
    ['expired', 410],
    ['no_local_date', 410],
    ['blocked', 422],
    ['empty', 422],
    ['out_of_range', 422],
    ['invalid_grams', 422],
    ['text_too_long', 422],
    ['empty_text', 422],
    ['match_failed', 422],
    ['not_saved', 409],
    ['not_confirmed', 400],
    ['write_failed', 500],
  ];

  it.each(table)('maps %s to %d', (reason, status) => {
    expect(reasonToStatus(reason)).toBe(status);
  });

  it('throws for already_confirmed (idempotent success, not an error)', () => {
    expect(() => reasonToStatus('already_confirmed')).toThrow();
  });

  it('throws for already_deleted (idempotent success, not an error)', () => {
    expect(() => reasonToStatus('already_deleted')).toThrow();
  });

  it('maps an unrecognised reason to 500', () => {
    expect(reasonToStatus('some_unknown_reason')).toBe(500);
  });
});

describe('parseDraftId', () => {
  const cases: Array<[unknown, number | null]> = [
    ['42', 42],
    ['abc', null],
    ['', null],
    [undefined, null],
    ['1.5', null],
    ['-1', null],
    ['9007199254740993', null],
  ];

  it.each(cases)('parseDraftId(%j) -> %j', (input, expected) => {
    expect(parseDraftId(input)).toBe(expected);
  });
});

describe('sendError', () => {
  it('writes { error } and nothing else', () => {
    const res = makeRes();
    sendError(res, 422, 'blocked');
    expect(res.statusCode).toBe(422);
    expect(res.jsonBody).toEqual({ error: 'blocked' });
  });
});

describe('logApiError', () => {
  it('logs only operation, draft id and reason — never body/component/transcript text', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logApiError('swap-candidate', 7, 'out_of_range');
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(line).toContain('swap-candidate');
    expect(line).toContain('7');
    expect(line).toContain('out_of_range');
    spy.mockRestore();
  });
});
