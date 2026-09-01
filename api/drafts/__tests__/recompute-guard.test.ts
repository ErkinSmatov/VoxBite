/**
 * recompute-guard — the cross-endpoint tripwire whose absence let a real
 * production defect happen: 04-UAT.md rounds 3-4 / CR-02 recorded that
 * correcting an already-saved (reopened) diary entry left the saved diary
 * row stale, because the "recompute the saved entry after a mutation" guard
 * was missing on the correction path. Five mutation endpoints in this phase
 * (`swap-candidate`, `adjust-grams`, `typed-grams`, `remove-component`,
 * `add-component`) each now carry that guard INDEPENDENTLY, on purpose — it
 * is deliberately repeated rather than abstracted into shared middleware,
 * because a shared abstraction that silently no-ops is exactly the kind of
 * single point of failure that caused CR-02 in the first place. A guard
 * repeated five times is a guard that can be forgotten once. This test is
 * what makes forgetting it, in any one of them, impossible.
 *
 * Adding a SIXTH mutation endpoint under `api/drafts/[id]/*.ts` REQUIRES
 * adding a row to `MUTATION_ENDPOINTS` below. A new endpoint that mutates a
 * draft and is absent from this table is a bug, not an omission — the
 * filesystem-derived count assertion at the bottom of this file fails the
 * whole suite the moment such an endpoint exists without a matching table
 * row, precisely so this can never be caught only by a human review that
 * misses it (the same class of miss that produced CR-02).
 *
 * Like `src/bot/entry-point-reachability.test.ts`, this test must never be
 * weakened into something that only proves each endpoint calls SOME
 * function — it must keep asserting the wired `recomputeSavedEntry`
 * reference specifically, and it must keep the deliberate-break property:
 * removing the guard from any one endpoint, or adding an unlisted mutation
 * endpoint, must fail this suite.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeReq, makeRes } from '../../_lib/__tests__/fakes';
import type { Db } from '../../_lib/db';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { DraftComponent, PersistedDraft } from '../../../src/application/types';

vi.mock('../../_lib/http', async () => {
  const actual = await vi.importActual<typeof import('../../_lib/http')>('../../_lib/http');
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

const { requireUser } = await import('../../_lib/http');
const { createSwapCandidateHandler } = await import('../[id]/swap-candidate');
const { createAdjustGramsHandler } = await import('../[id]/adjust-grams');
const { createTypedGramsHandler } = await import('../[id]/typed-grams');
const { createRemoveComponentHandler } = await import('../[id]/remove-component');
const { createAddComponentHandler } = await import('../[id]/add-component');

const USER = { id: 7, timezone: 'Asia/Almaty' };
const DRAFT_ID = 42;

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
    id: DRAFT_ID,
    userId: USER.id,
    chatId: 100,
    messageId: 200,
    source: 'voice',
    transcript: 'курица 150г',
    components: [makeComponent()],
    status: 'draft',
    localDate: '2026-08-31',
    diaryId: null,
    createdAt: new Date('2026-08-31T12:00:00Z'),
    ...overrides,
  };
}

function fakeGetDb(): Db {
  return {} as Db;
}

function fakeDb(): Db {
  return {} as Db;
}

interface HandlerBuild {
  appFn: ReturnType<typeof vi.fn>;
  readDraft: ReturnType<typeof vi.fn>;
  recomputeSavedEntry: ReturnType<typeof vi.fn>;
}

interface MutationEndpointCase {
  name: string;
  body: unknown;
  build: (h: HandlerBuild) => (req: VercelRequest, res: VercelResponse) => Promise<void>;
}

/**
 * Every mutation endpoint currently under `api/drafts/[id]/*.ts`, paired
 * with a minimal valid request body and a factory that wires the endpoint's
 * own createXHandler with the SAME fake application function, readDraft, and
 * recomputeSavedEntry across all five, so the assertions below are testing
 * one shared contract, not five different ones.
 */
const MUTATION_ENDPOINTS: MutationEndpointCase[] = [
  {
    name: 'swap-candidate',
    body: { componentIndex: 0, candidateIndex: 1 },
    build: ({ appFn, readDraft, recomputeSavedEntry }) =>
      createSwapCandidateHandler({
        getDb: fakeGetDb,
        swapCandidate: appFn as never,
        readDraft: readDraft as never,
        recomputeSavedEntry: recomputeSavedEntry as never,
      }),
  },
  {
    name: 'adjust-grams',
    body: { componentIndex: 0, direction: 'up' },
    build: ({ appFn, readDraft, recomputeSavedEntry }) =>
      createAdjustGramsHandler({
        getDb: fakeGetDb,
        adjustGrams: appFn as never,
        readDraft: readDraft as never,
        recomputeSavedEntry: recomputeSavedEntry as never,
      }),
  },
  {
    name: 'typed-grams',
    body: { componentIndex: 0, raw: '150' },
    build: ({ appFn, readDraft, recomputeSavedEntry }) =>
      createTypedGramsHandler({
        getDb: fakeGetDb,
        applyTypedGrams: appFn as never,
        readDraft: readDraft as never,
        recomputeSavedEntry: recomputeSavedEntry as never,
      }),
  },
  {
    name: 'remove-component',
    body: { componentIndex: 0 },
    build: ({ appFn, readDraft, recomputeSavedEntry }) =>
      createRemoveComponentHandler({
        db: fakeDb(),
        removeComponent: appFn as never,
        readDraft: readDraft as never,
        recomputeSavedEntry: recomputeSavedEntry as never,
      }),
  },
  {
    name: 'add-component',
    body: { raw: 'сметана' },
    build: ({ appFn, readDraft, recomputeSavedEntry }) =>
      createAddComponentHandler({
        db: fakeDb(),
        addComponent: appFn as never,
        readDraft: readDraft as never,
        recomputeSavedEntry: recomputeSavedEntry as never,
        getMatchingDeps: () => ({ embedder: {} as never, repo: {} as never }),
      }),
  },
];

describe('recompute-guard cross-endpoint tripwire (CR-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireUser).mockResolvedValue(USER);
  });

  it('the table enumerates exactly five mutation endpoints', () => {
    expect(MUTATION_ENDPOINTS).toHaveLength(5);
  });

  it.each(MUTATION_ENDPOINTS)(
    '$name calls recomputeSavedEntry(db, draftId, userId) exactly once when the draft is already confirmed',
    async ({ body, build }) => {
      const appFn = vi.fn(async () => ({ ok: true as const, components: [makeComponent()] }));
      const readDraft = vi.fn(async () => makeDraft({ status: 'confirmed', diaryId: 99 }));
      const recomputeSavedEntry = vi.fn(async () => ({ ok: true as const, diaryId: 99 }));
      const handler = build({ appFn, readDraft, recomputeSavedEntry });

      const req = makeReq({ method: 'POST', query: { id: String(DRAFT_ID) }, body });
      const res = makeRes();
      await handler(req, res);

      expect(recomputeSavedEntry).toHaveBeenCalledTimes(1);
      expect(recomputeSavedEntry).toHaveBeenCalledWith(expect.anything(), DRAFT_ID, USER.id);
    },
  );

  it.each(MUTATION_ENDPOINTS)(
    '$name never calls recomputeSavedEntry when the draft is a plain (unconfirmed) draft',
    async ({ body, build }) => {
      const appFn = vi.fn(async () => ({ ok: true as const, components: [makeComponent()] }));
      const readDraft = vi.fn(async () => makeDraft({ status: 'draft', diaryId: null }));
      const recomputeSavedEntry = vi.fn();
      const handler = build({ appFn, readDraft, recomputeSavedEntry });

      const req = makeReq({ method: 'POST', query: { id: String(DRAFT_ID) }, body });
      const res = makeRes();
      await handler(req, res);

      expect(recomputeSavedEntry).not.toHaveBeenCalled();
    },
  );

  it('the number of mutation endpoints on disk matches the table above -- a new endpoint MUST be added here too', () => {
    const idDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '[id]');
    const NON_MUTATING_ENDPOINTS = new Set(['confirm.ts', 'recompute.ts', 'delete.ts', 'cancel.ts']);

    const allEndpointFiles = readdirSync(idDir).filter((file) => file.endsWith('.ts'));
    const mutationFiles = allEndpointFiles.filter((file) => !NON_MUTATING_ENDPOINTS.has(file));

    expect(
      mutationFiles.length,
      `api/drafts/[id] contains ${mutationFiles.length} mutation endpoint file(s) (${mutationFiles.join(', ')}) ` +
        `but MUTATION_ENDPOINTS in this test only lists ${MUTATION_ENDPOINTS.length} ` +
        `(${MUTATION_ENDPOINTS.map((e) => e.name).join(', ')}). A new mutation endpoint under ` +
        `api/drafts/[id]/*.ts must be added to MUTATION_ENDPOINTS in this file or it is untested ` +
        `for the CR-02 recompute guard.`,
    ).toBe(MUTATION_ENDPOINTS.length);
  });
});
