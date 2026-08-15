---
phase: 04-confirm-correct-diary-persistence
plan: 04
subsystem: application
tags: [drizzle-orm, postgresql, drafts, idor, cas]

# Dependency graph
requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 01
    provides: diary_drafts.awaiting_input/local_date/diary_id columns and the DraftAwaitingInput interface
provides:
  - "src/application/types.ts: DRAFT_TTL_HOURS, isDraftExpired(status, createdAt, now), PersistedDraft, re-exported DraftAwaitingInput"
  - "src/application/draft-store.ts: readDraft, findAwaitingDraft, updateDraftComponents, setAwaitingInput, clearAwaitingInput, markDraftStatus, claimConfirm, claimAbandon, linkDiaryRow"
  - "src/application/draft-store.test.ts: automated CORRECT-07/D-11/IDOR/CAS coverage"
affects: [04-05, 04-06, 04-07, 04-08, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every draft read/write filters on and(eq(id, draftId), eq(userId, userId)) together -- draftId from callback_data is never authorization on its own (V4/IDOR)"
    - "Compare-and-swap only where a duplicate write is a silent correctness bug (claimConfirm/claimAbandon), not on every mutation (gram adjustments accept the double-tap nuisance)"
    - "One parameterised status-transition function (markDraftStatus) instead of per-status variants, mirroring idempotency.ts's markUpdateStatus"

key-files:
  created:
    - src/application/draft-store.test.ts
  modified:
    - src/application/types.ts
    - src/application/draft-store.ts

key-decisions:
  - "updateDraftComponents accepts status IN ('draft', 'confirmed') because editing a saved entry (D-05/CORRECT-08) mutates a confirmed draft in place; an abandoned row must never be resurrected by a stray write"
  - "isDraftExpired takes now as a parameter rather than calling new Date() internally, so this plan's tests and later handler tests share one fixed-clock-testable rule and can never disagree about staleness"

requirements-completed: [CORRECT-07, CORRECT-02, CORRECT-08]

# Metrics
duration: 35min
completed: 2026-08-15
---

# Phase 4 Plan 04: Draft Store Persistence Layer Summary

**Extended `diary_drafts` from a Phase 3 write-once artifact into the full user-scoped read/mutate/claim API the entire correction flow (plans 07-10) runs on, with automated CORRECT-07/D-11/IDOR/CAS test coverage.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 (all auto)
- **Files modified:** 3 (2 extended, 1 new test file)

## Accomplishments
- `src/application/types.ts` gained `DRAFT_TTL_HOURS` (D-11, 24h), `isDraftExpired(status, createdAt, now)` as the single shared staleness rule (confirmed drafts exempt per D-06), `PersistedDraft` (the shape `readDraft` returns), and a type-only re-export of `DraftAwaitingInput` so downstream plans never import the schema directly for a type.
- `src/application/draft-store.ts` gained nine user-scoped functions: `readDraft`, `findAwaitingDraft`, `updateDraftComponents`, `setAwaitingInput`, `clearAwaitingInput`, `markDraftStatus`, `claimConfirm`, `claimAbandon`, `linkDiaryRow` — every one filters `and(eq(id, draftId), eq(userId, userId))`, no unscoped overload exists.
- `claimConfirm` and `claimAbandon` are compare-and-swap: conditional `UPDATE ... WHERE status = <expected> RETURNING id`. A double tap on either loses the race (returns `false`) instead of producing a second diary row (Pitfall 3). This CAS protection is deliberately **not** extended to gram adjustments — documented as an accepted tradeoff in the module header, matching the plan's objective.
- `src/application/draft-store.test.ts` (new, closes a Wave 0 gap flagged in 04-VALIDATION.md): 21 tests covering IDOR scoping (asserted against the real tagged condition tree, not just return values), the CORRECT-07 round-trip of `components` through the store, `setAwaitingInput`/`clearAwaitingInput`, `findAwaitingDraft`'s ordering, all four `isDraftExpired` status/age combinations, and both `claimConfirm`/`claimAbandon` double-tap no-op paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Draft state types — expiry rule and the persisted-draft shape** - `47b7a25` (feat)
2. **Task 2: draft-store read/write operations with IDOR scoping and CAS claims** - `4d2ff26` (feat)
3. **Task 3: draft-store.test.ts — persistence, scoping, expiry and CAS coverage** - `4c5297b` (test)

## Files Created/Modified
- `src/application/types.ts` — added `DRAFT_TTL_HOURS`, `isDraftExpired`, `PersistedDraft`, re-exported `DraftAwaitingInput`
- `src/application/draft-store.ts` — added the nine functions above; module header restates the two `src/application/` hard rules, the IDOR rule, and the accepted CAS tradeoff
- `src/application/draft-store.test.ts` — new, 21 tests, fake-`db` follows `idempotency.test.ts`'s tagged-condition mocking style

## Decisions Made
- `updateDraftComponents`'s where-clause accepts `status IN ('draft', 'confirmed')` (not just `'draft'`) because editing a saved diary entry (D-05/CORRECT-08) is defined as mutating the confirmed draft in place. An `'abandoned'` row is excluded so a stray write can never resurrect it.
- `isDraftExpired` takes `now` as an explicit parameter rather than calling `new Date()` internally — this is the same "one shared rule, testable with a fixed clock" precedent as `isWeakMatch` in the same file, so this plan's tests and plan 09's handler tests can never compute staleness differently.
- Selected columns for `readDraft`/`findAwaitingDraft` are centralized in one `draftColumns` object inside `draft-store.ts` (not exported) to keep the two read functions' column lists from drifting apart.

## Deviations from Plan

None — plan executed exactly as written. One implementation-detail fix during Task 2 write-up (not a deviation from the plan's intent): the `updateDraftComponents` predicate needed `or(eq(status,'draft'), eq(status,'confirmed'))`, written correctly on first pass after re-reading the plan's spec (`status = 'draft'` OR `status = 'confirmed'`).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This plan touches only application-layer TypeScript; no migration, no new environment variable.

## Next Phase Readiness

- Plans 07 (correction operations), 08 (confirm/edit/delete), 09 (Telegram button handlers) and 10 (text-gate routing) now have every persistence primitive they need: user-scoped reads and writes, the shared expiry rule, and CAS-protected confirm/abandon claims.
- The accepted CAS tradeoff on gram adjustments (documented in `draft-store.ts`'s module header and in this plan's objective) should be revisited only if beta users report grams "not registering" — do not pre-emptively add a `version` column.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*
