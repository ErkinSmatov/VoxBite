---
phase: 04-confirm-correct-diary-persistence
plan: 13
subsystem: bot
tags: [drizzle-orm, telegram, correction-flow, diary-drafts, gap-closure]

# Dependency graph
requires:
  - phase: 04-confirm-correct-diary-persistence
    provides: D-01..D-12 correction flow (draft-store.ts, correction.ts, meal.ts D-04 text gate)
provides:
  - findAwaitingDraft now matches both status='draft' and status='confirmed' draft rows
  - handleAwaitingText recomputes the linked diary row for text-based corrections on saved entries
  - A seam-level regression test proving the real D-04 gate routes correctly and empirically fails when either fix is reverted
affects: [phase-04-uat, phase-04-review]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/application/draft-store.ts
    - src/application/draft-store.test.ts
    - src/bot/handlers/correction.ts
    - src/bot/handlers/correction.test.ts
    - src/bot/handlers/meal.test.ts

key-decisions:
  - "Widened findAwaitingDraft's filter to status IN ('draft','confirmed') rather than flipping case 'edit' back to status='draft' — status is never mutated by this fix, so claimConfirm/claimAbandon's independent CAS gates are provably unaffected."
  - "handleAwaitingText resolves its own recomputeSavedEntry via d.recomputeSavedEntry ?? recomputeSavedEntryReal (it is a standalone exported function, not nested inside createCorrectionCallbackHandler where the existing binding lives)."
  - "The add_component branch's recompute guard is placed once, before either the 'added but no candidates' redraw and the final success redraw, since both represent a components change that changed the saved entry's totals."

requirements-completed: [CORRECT-04, CORRECT-06, CORRECT-08]

# Metrics
duration: 20min
completed: 2026-08-24
---

# Phase 04 Plan 13: Gap Closure — Typed Correction Routing on Reopened Saved Entries Summary

**Widened `findAwaitingDraft`'s filter to `status IN ('draft','confirmed')` and added the missing `recomputeSavedEntry` call in `handleAwaitingText`, closing the live-confirmed CR-01/CR-02 defects where typing a correction into a reopened saved diary entry leaked into the paid meal pipeline and, even once routed correctly, never updated the saved entry's totals.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3/3 completed
- **Files modified:** 5

## Accomplishments

- CR-01 closed: `findAwaitingDraft` (`src/application/draft-store.ts`) now matches `status = 'draft'` OR `status = 'confirmed'` rows with `awaiting_input` set, using the exact `or(...)` shape `updateDraftComponents` already used two functions above it in the same file. A `status = 'abandoned'` row with a stale `awaiting_input` is still correctly excluded.
- CR-02 closed: `handleAwaitingText` (`src/bot/handlers/correction.ts`) now calls `recomputeSavedEntry(db, draft.id, user.id)` in both the `typed_grams` and `add_component` branches whenever `draft.status === 'confirmed'`, mirroring the button-handler pattern (`case 'cand'`/`'gm'`/`'gp'`/`'rm'`) exactly. A fresh `'draft'` draft or a rejected correction still never triggers a recompute.
- Added a seam-level regression test (`src/bot/handlers/meal.test.ts`, `describe('D-04 text gate seam: real findAwaitingDraft routing (gap closure 04-13)')`) that routes through `createTextHandler` wired with `interceptCorrectionText` built from the REAL `createCorrectionTextHandler` (and thus the real, unoverridden `findAwaitingDraft`) against a hand-built fake `diary_drafts` db — not a mock that assumes the fix. Asserts `processMeal` is called zero times, `applyTypedGrams` exactly once, and `recomputeSavedEntry` exactly once.
- **Empirically verified (not just reasoned through) that this test fails against either fix reverted**, per the plan's `<verification>` item 3 — see "Manual Trace Verification" below.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix CR-01 — widen findAwaitingDraft to match confirmed drafts too** - `e5efc86` (fix)
2. **Task 2: Fix CR-02 — handleAwaitingText recomputes the saved diary row on a confirmed draft** - `4ab8b95` (fix)
3. **Task 3: Seam regression test — real routing, zero paid-pipeline calls, from meal.ts's own gate** - `28f359f` (test)

_No plan-metadata commit is included here — the orchestrator owns STATE.md/ROADMAP.md updates and the final metadata commit, per this plan's execution instructions._

## Manual Trace Verification

Per the plan's `<verification>` item 3, both reverts were performed for real in this worktree (not just reasoned through), the seam test was re-run in isolation after each, and both files were then restored byte-for-byte (confirmed via empty `git diff`) before the Task 3 commit:

- **Reverting Task 1** (`draft-store.ts`'s `or(eq(status,'draft'), eq(status,'confirmed'))` back to a bare `eq(status, 'draft')`): the seam test's fixture row (`status: 'confirmed'`) no longer matches `findAwaitingDraft`'s filter, so it returns `null`, `interceptCorrectionText` reports `false`, and `meal.ts` falls through to `claimUpdate`/`processMeal`. Result: `expect(d.processMeal).toHaveBeenCalledTimes(0)` failed with `AssertionError: expected "vi.fn()" to be called +0 times, but got 1 times`.
- **Reverting Task 2** (removing the `if (draft.status === 'confirmed') { await recomputeSavedEntry(...) }` guard from the `typed_grams` branch): `recomputeSavedEntrySpy` is never invoked. Result: `expect(recomputeSavedEntrySpy).toHaveBeenCalledTimes(1)` failed with `AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`.

Both fixes are therefore load-bearing for this test, not incidentally passing.

## Files Created/Modified

- `src/application/draft-store.ts` — `findAwaitingDraft`'s `where` clause widened to `and(eq(userId), or(eq(status,'draft'), eq(status,'confirmed')), isNotNull(awaitingInput))`; doc comment updated to explain why (CORRECT-08, this plan's `<objective>`).
- `src/application/draft-store.test.ts` — two new tests in the existing `describe('findAwaitingDraft', ...)` block: a `status: 'confirmed'` row with `awaitingInput` set IS returned; a `status: 'abandoned'` row with a stale `awaitingInput` is NOT returned.
- `src/bot/handlers/correction.ts` — `handleAwaitingText` resolves its own `recomputeSavedEntry` binding and calls it (guarded by `draft.status === 'confirmed'`) after a successful `applyTypedGrams` (before `renderLevel2`) and after a successful `addComponent` (before either `renderLevel1` redraw).
- `src/bot/handlers/correction.test.ts` — four new tests in `describe('handleAwaitingText ...)`: recompute called for confirmed+typed-grams success, recompute called for confirmed+add-component success, recompute NOT called for a fresh `'draft'` draft, recompute NOT called for a rejected (`invalid_grams`) correction.
- `src/bot/handlers/meal.test.ts` — file-scoped `vi.mock('drizzle-orm', ...)`, a copied `makeFakeDraftDb`/`makeFakeDraftRow`/`draftMatches` harness (mirroring `draft-store.test.ts`'s, not imported across files), an `api.editMessageText` stub added to the shared `makeCtx` (needed by `handleAwaitingText`'s redraw path, unused by every pre-existing test), and the new seam-level `describe` block described above.

## Decisions Made

- Followed the plan's explicit routing decision: widened `findAwaitingDraft`'s filter rather than flipping `case 'edit'`'s status back to `'draft'`. This keeps `claimConfirm`/`claimAbandon`'s own independent CAS gates (which fire on their own explicit `status`/`fromStatus` checks) completely untouched — verified by full-suite green (687/687) and by the fact that neither function's `where` clause was modified.
- `handleAwaitingText`'s `recomputeSavedEntry` resolution mirrors the exact pattern already used for `applyTypedGrams`/`addComponent`/`clearAwaitingInput`/`markDraftStatus`/`now` at the top of that function (`d.recomputeSavedEntry ?? recomputeSavedEntryReal`), rather than trying to share the binding declared inside `createCorrectionCallbackHandler` (a different, sibling function).

## Deviations from Plan

None — plan executed exactly as written. The one thing plan-checker flagged as a non-blocking gap (the seam test needing `ctx.api.editMessageText` on `meal.test.ts`'s `makeCtx`, which didn't previously have an `api` field) was hit exactly as predicted and fixed exactly as the plan's `<critical_plan_notes>` prescribed: extended `makeCtx` with an `api: { editMessageText: vi.fn(...) }` stub. This is a fixture gap, not a code-fix problem, and does not affect any pre-existing test (none of them read `ctx.api`).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**This is NOT re-verified live yet**, per the same honesty bar plan `04-12` held for CORRECT-07/CALC-02. This plan closes the code-level defect and adds the regression coverage (draft-store.test.ts, correction.test.ts, and a real-routing seam test in meal.test.ts) that should have caught it originally — full suite is green (687/687 tests, `npx tsc --noEmit` exits 0). But **the owner has not yet re-tested the exact live scenario** on a running bot: reopen a confirmed diary entry via `✎ Поправить`, then correct it by **typing** (grams or a new component) rather than tapping a button, and confirm (a) the correction is applied to the existing entry, not a new one, and (b) the diary totals update to match. Add this scenario to `docs/phase-04-manual-checklist.md` (or re-run the equivalent ad hoc steps used in Round 3) and get an explicit pass/fail before considering CORRECT-04/CORRECT-06/CORRECT-08 fully closed for text-based saved-entry editing.

The stray live `diary id=3` row from Round 3 was the owner's own responsibility to delete via the app's `🗑 Удалить` flow — this plan did not touch production data and wrote no migration/cleanup script, per the plan's explicit scope boundary.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-24*
