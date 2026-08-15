---
phase: 04-confirm-correct-diary-persistence
plan: 08
subsystem: application
tags: [drizzle-orm, postgresql, calc, idor, cas, tdd]

# Dependency graph
requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 01
    provides: diary.draft_id NOT NULL, diary_drafts.local_date (nullable), diary_drafts.diary_id
  - phase: 04-confirm-correct-diary-persistence
    plan: 02
    provides: calculateTotal(items) -- the single CALC-01/D-09 nutrient-summation function
  - phase: 04-confirm-correct-diary-persistence
    plan: 04
    provides: "readDraft, claimConfirm, claimAbandon, linkDiaryRow, markDraftStatus (all user-scoped)"
provides:
  - "src/application/confirm-meal.ts: findBlockingComponent, buildDiaryDescription, confirmMeal, recomputeSavedEntry, deleteSavedEntry"
  - "src/application/confirm-meal.test.ts: CORRECT-02/08, CALC-01/02, DIARY-01, D-08, D-10 coverage against a fake Db"
affects: [04-09-telegram-button-handlers, 04-10-text-gate-routing]

tech-stack:
  added: []
  patterns:
    - "confirmMeal's confirmation checks (not_found -> expired -> empty -> blocked -> no_local_date) all run BEFORE claimConfirm's compare-and-swap, so the CAS claim is the last gate before any write"
    - "deleteSavedEntry's second gate checks diaryId !== null only, deliberately NOT status === 'confirmed' -- after a first delete the draft is already 'abandoned' but diaryId is left in place, so a repeat call still reaches claimAbandon and observes the CAS-loss outcome (already_deleted) instead of being turned away one step earlier by a status check"
    - "A failed diary INSERT after a successful claimConfirm reverts the draft to 'draft' via markDraftStatus -- the one place a plain conditional UPDATE (CAS) is not sufficient on its own, because the CAS already fired before the write that could fail"

key-files:
  created:
    - src/application/confirm-meal.ts
    - src/application/confirm-meal.test.ts

key-decisions:
  - "The neutral fallback description label ('Приём пищи', used only when both the draft transcript and every component name are empty/whitespace) is kept as a local const in confirm-meal.ts rather than added to src/bot/formatting/correction-copy.ts, to respect this plan's declared file scope during a parallel wave. Flagged in-code as a small gap for plan 09/10 to fold into the copy module if a second caller ever needs the same string."
  - "recomputeSavedEntry and deleteSavedEntry both accept an unused now?: Date parameter for interface parity with confirmMeal and plan 09's expected call sites, even though neither currently needs it (a confirmed draft is exempt from the D-11 expiry check)."
  - "deleteSavedEntry's not_saved gate checks draft.diaryId === null only (not draft.status === 'confirmed') -- see tech-stack pattern above; this was discovered via a failing test during implementation, not pre-planned, and is the one place this plan's behavior deviates in mechanism (not outcome) from a literal reading of the plan's action text."

requirements-completed: [CORRECT-02, CORRECT-08, CALC-01, CALC-02, DIARY-01]

# Metrics
duration: 45min
completed: 2026-08-15
---

# Phase 4 Plan 08: Confirm/Correct Diary Persistence Summary

**`confirm-meal.ts` — the diary-write boundary of the whole phase: `confirmMeal` turns a validated draft into exactly one `diary` row using `calculateTotal()`'s raw output (never a second summation, never a 0-for-null coalesce), gated by D-10's missing-match block and a CAS claim that makes a double tap a no-op; `recomputeSavedEntry`/`deleteSavedEntry` extend the same machinery to editing and hard-deleting a saved entry.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (both `tdd="true"`, executed test-first per task)
- **Files modified:** 2 (both new)

## Accomplishments

- `confirmMeal(db, draftId, userId, now?)`: reads the draft (IDOR-scoped), checks expiry (D-11), the empty-components state (D-12), D-10's missing-FDC-match block (naming the offending component), and the pre-Phase-4 `local_date IS NULL` leftover case — all BEFORE the `claimConfirm` compare-and-swap claim. Only after the claim succeeds does it call `calculateTotal` and INSERT into `diary`, with `localDate` copied verbatim from the draft (never recomputed) and every nutrient value (including `null`) passed through unchanged. A failed INSERT after a successful claim reverts the draft to `'draft'` via `markDraftStatus` so the confirm button is retryable rather than leaving a stuck confirmed-with-no-diary-row state.
- `findBlockingComponent` and `buildDiaryDescription` are exported standalone (not just used internally) so plan 09's handler can render `correctionCopy.blockedConfirm(name)` from the exact same D-10 rule, and so the description-fallback logic (transcript -> joined component names -> neutral label) is independently testable.
- `recomputeSavedEntry(db, draftId, userId, now?)`: CORRECT-08's edit path. Requires the draft to be `'confirmed'` with a non-null `diaryId`, re-runs `findBlockingComponent` (a saved entry cannot be edited into an untrustworthy state either), and UPDATEs the diary row's nutrient columns + description — but the update payload never includes `localDate` (D-07/Pitfall 4 — asserted directly in a test via `hasOwnProperty`).
- `deleteSavedEntry(db, draftId, userId, confirmed, now?)`: D-08's real, permanent delete. Requires the caller to pass `confirmed: true` (a structural stand-in for the two-step Telegram confirmation prompt), then runs `claimAbandon(..., 'confirmed')` BEFORE the DELETE so a repeated call loses the CAS race and reports `already_deleted` without a second DELETE. The linked `diary_drafts` row becomes `'abandoned'`, never deleted, retaining its transcript (documented known-debt, no purge scheduler in this phase).
- `src/application/confirm-meal.test.ts` (Wave 0 gap): 29 tests, hand-built fake `db` extending the `draft-store.test.ts` tagged-condition-mocking convention to also cover `diary` table insert/update/delete, asserting on real Drizzle column identity (`diary.id`, `diary.userId`) rather than guessed string keys.

## Task Commits

Each task was committed atomically (TDD-shaped: implementation + its own test coverage per task):

1. **Task 1: confirmMeal — the D-10 block, the CALC-01 write, and the CAS claim** - `bc952e4` (feat)
2. **Task 2: recomputeSavedEntry and deleteSavedEntry — CORRECT-08 and D-08** - `e4d555b` (feat)

## Files Created/Modified

- `src/application/confirm-meal.ts` — `findBlockingComponent`, `buildDiaryDescription`, `confirmMeal`, `recomputeSavedEntry`, `deleteSavedEntry`; module header restates the two `src/application/` hard rules, the IDOR rule, and the logging rule (no transcript/description/component text ever logged)
- `src/application/confirm-meal.test.ts` — 29 tests: `findBlockingComponent`/`buildDiaryDescription` unit coverage, `confirmMeal`'s 10-behavior matrix (full totals, all-null sugar via `toBeNull()`, partial-sum lower bound, verbatim `localDate`, D-10 block, D-12 empty, `no_local_date`, `already_confirmed` CAS no-op, `linkDiaryRow` wiring, cross-user IDOR, `not_found`, `expired`), `recomputeSavedEntry`'s `editSaved`-tagged subset, `deleteSavedEntry`'s `delete`-tagged subset

## Decisions Made

- The neutral fallback description label is kept local to `confirm-meal.ts` rather than added to `src/bot/formatting/correction-copy.ts` — this plan's declared file scope (per the parallel-wave conflict boundary with plan 04-07) is only `confirm-meal.ts`/`confirm-meal.test.ts`, and this is a one-caller string with no test currently exercising the exact wording, so centralizing it was deferred rather than risking an out-of-scope edit during a parallel wave. Flagged in a code comment for plan 09/10 to fold in if a second caller needs it.
- `deleteSavedEntry`'s second gate checks `diaryId !== null` only, not `status === 'confirmed'` — discovered via a failing test (`Rule 1 — bug fix`, see Deviations below), not planned up front, because the plan's behavior list explicitly requires a second call to reach `claimAbandon` and observe its CAS-loss outcome, which a status-based gate would prevent (the draft is already `'abandoned'` by then).
- `recomputeSavedEntry`/`deleteSavedEntry` both keep an unused `now?: Date` parameter for interface parity with `confirmMeal` and plan 09's expected call sites (per 04-08-PLAN.md's stated signatures), even though neither currently reads it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `deleteSavedEntry`'s not-saved gate blocked the plan's own required double-delete behavior**

- **Found during:** Task 2, writing the "second call performs zero additional DELETEs and reports already_deleted" test.
- **Issue:** The plan's action text says to "require `status === 'confirmed'` and `diaryId !== null`" before calling `claimAbandon`. Implemented literally, a second `deleteSavedEntry` call on an already-deleted entry finds the draft's status now `'abandoned'` (set by the first call) and returns `not_saved` — never reaching `claimAbandon` at all. But the plan's `<behavior>` list explicitly states: "deleteSavedEntry called twice performs at most one DELETE: the second call finds claimAbandon returning false and reports the already-handled outcome without error" — i.e. the second call MUST reach `claimAbandon` and observe its CAS-loss (`false`) return, not be turned away one gate earlier.
- **Fix:** Narrowed the pre-`claimAbandon` gate to check `diaryId !== null` only (dropping the `status === 'confirmed'` half). `diaryId` is left in place on the draft row after delete (only `status` flips to `'abandoned'`), so this still correctly refuses a draft that was never confirmed (`diaryId` stays `null` for those), while letting a repeat call on an already-deleted entry reach `claimAbandon`, lose the CAS race, and return `already_deleted` as the plan's behavior list requires.
- **Files modified:** `src/application/confirm-meal.ts` (the `deleteSavedEntry` gate and its doc comment explaining the deliberate omission)
- **Verification:** The "second call" test passes; `npx tsc --noEmit` exits 0; full test suite (634 tests) green.
- **Committed in:** `e4d555b`

**2. [Rule 1 - Bug] Comments containing the literal word "soft" broke the D-08 acceptance grep**

- **Found during:** Task 2, running the plan's stated `grep -n "deletedAt\|isDeleted\|soft" src/application/confirm-meal.ts` acceptance check.
- **Issue:** Explanatory doc comments describing what the delete is NOT (no "soft-delete column") contained the substring the grep is designed to catch, causing a false positive against the plan's own literal verification command.
- **Fix:** Reworded the comments to state the same fact ("a real, permanent delete — no reversible-flag column, no tombstone row") without the word "soft".
- **Files modified:** `src/application/confirm-meal.ts` (module header + `deleteSavedEntry`'s doc comment)
- **Verification:** `grep -n "deletedAt\|isDeleted\|soft" src/application/confirm-meal.ts` now returns nothing (exit 1).
- **Committed in:** `e4d555b`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bug fixes surfaced by the plan's own acceptance criteria/behavior list; neither changed the plan's intended outcomes, both fixes make the implementation match the plan's stated behavior more precisely than a literal first reading of the action prose did).

## Issues Encountered

None beyond the two auto-fixed deviations above. No auth gates, no checkpoints — this plan is fully autonomous per its frontmatter.

## User Setup Required

None — no external service configuration required. This plan touches only application-layer TypeScript; no migration, no new environment variable.

## Next Phase Readiness

- Plan 09 (Telegram button handlers) can now call `confirmMeal`, `recomputeSavedEntry`, and `deleteSavedEntry` directly and render `correctionCopy.blockedConfirm(name)` / `correctionCopy.deletePrompt` around the exported `findBlockingComponent` rule and the `confirmed: true` structural gate.
- The local `NEUTRAL_DESCRIPTION_FALLBACK` string in `confirm-meal.ts` is a small, explicitly-flagged gap: if plan 09 or 10 needs the same "empty everything" fallback wording elsewhere, fold it into `src/bot/formatting/correction-copy.ts` at that point rather than duplicating the literal.
- `recomputeSavedEntry`/`deleteSavedEntry`'s unused `now?: Date` parameters are ready for plan 09 to pass a fixed clock through if its own handler tests need one, matching `confirmMeal`'s existing signature shape.

---

*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*
