---
phase: 04-confirm-correct-diary-persistence
plan: 06
subsystem: bot
tags: [typescript, vitest, telegram, inline-keyboard, i18n]

requires:
  - phase: 04-confirm-correct-diary-persistence
    provides: "calculateTotal (plan 02) — the single CALC-01/D-09 nutrient-summation function; correctionCopy + safeEditMessageText (plan 03) — every Russian string and the idempotent redraw helper"
provides:
  - "buildCorrectionCard/buildComponentEditCard/buildConfirmedCard/formatTotalsBlock (src/bot/formatting/correction-card.ts) — the two-level correction UI, the D-12 empty state, and the D-05 saved-entry card, all sharing one totals renderer"
  - "CRC_PREFIX/encodeCrc/parseCrc/CRC_PATTERN + buildLevel1Keyboard/buildLevel2Keyboard/buildConfirmedKeyboard/buildDeleteConfirmKeyboard/buildEmptyStateKeyboard (src/bot/keyboards/correction-keyboards.ts) — the strict, byte-budgeted crc: callback codec and every button this phase needs"
affects: [04-09-handler-dispatch]

tech-stack:
  added: []
  patterns:
    - "formatTotalsBlock is the ONLY renderer of a NutrientTotal into Russian text; it builds TotalInputItem[] from each component's chosen candidate (never candidates[0] blindly) and calls calculateTotal — no second summation anywhere in the render path"
    - "crc:<draftId>:<action>[:<index>] callback codec, parsed only through an anchored regex (CRC_PATTERN) plus an action-union check and Number.isSafeInteger bounds — never split(':')"
    - "InlineKeyboard .row() called only BETWEEN buttons, never after the last one (same rule as onboarding-keyboards.ts, the trailing-empty-row bug already recorded in STATE.md)"

key-files:
  created:
    - src/bot/formatting/correction-card.ts
    - src/bot/formatting/correction-card.test.ts
    - src/bot/keyboards/correction-keyboards.ts
    - src/bot/keyboards/correction-keyboards.test.ts
  modified: []

key-decisions:
  - "correction-card.ts does NOT reuse result-card.ts's formatComponent, even though the plan offered that as the preferred path — result-card.ts always renders candidates[0] (Phase 3 had no editing), but Phase 4 must render whichever candidate the user has CHOSEN (chosenFdcId), which can diverge from candidates[0] once plan 09 lets the user re-select. A shared helper would have been semantically wrong, not just DRY-violating, so correction-card.ts has its own per-component renderer instead — result-card.ts was left untouched (out of this plan's declared files_modified)."
  - "buildLevel2Keyboard's candidate index is encoded into callback_data (0-based, converted to 1-based only for the button label); the component index is accepted as a parameter per the plan's signature but is NOT encoded — plan 09 is expected to recover it from the draft's stored level-2 selection state, exactly as the plan's action block anticipated as the default (non-awkward) path."
  - "buildEmptyStateKeyboard is the actual implementation for the D-12 empty state; buildLevel1Keyboard delegates to it for a 0-component draft rather than shipping two divergent empty-state code paths, while still exporting both names per the plan's artifact list."

requirements-completed: [CORRECT-01, CORRECT-03, CORRECT-04, CORRECT-05, CALC-02]

duration: 35min
completed: 2026-08-15
---

# Phase 04 Plan 06: Correction Card + Correction Keyboards Summary

**Two-level correction UI (meal list -> single-component candidate editor), the D-12 empty state, and the D-05 saved-entry card all render from one `formatTotalsBlock`/`calculateTotal` path with honest missing-nutrient handling; a strict, byte-budgeted `crc:` callback codec and its five keyboard builders back every button the flow needs.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-08-15T13:10:00Z
- **Completed:** 2026-08-15T13:45:00Z
- **Tasks:** 2
- **Files modified:** 4 (all new)

## Accomplishments
- `formatTotalsBlock` built as the single `NutrientTotal`-to-Russian-text renderer: rounds at render time only, emits a plain number when a nutrient is fully known, `correctionCopy.partialTotal` when partially known, and `correctionCopy.noData` (never `0`) when every contributing component lacks it — verified by tests computing `calculateTotal` independently and asserting the same rounded integers appear in the rendered card
- `buildCorrectionCard` (D-01 level 1, D-12 empty state), `buildComponentEditCard` (D-01/D-02 level 2, numbered VERBATIM candidate descriptions), and `buildConfirmedCard` (D-05, no `≈`/no not-saved marker) all implemented and unit-tested against every behavior in the plan
- `crc:` codec (`encodeCrc`/`parseCrc`/`CRC_PATTERN`) built strict and byte-budgeted: `parseCrc` returns `null` (never throws) for all 8 malformed inputs in the plan's behavior list, and every button across all 6 keyboard builders is asserted `<=64` UTF-8 bytes even at `draftId = 2147483647`
- Five keyboard builders (`buildLevel1Keyboard`, `buildLevel2Keyboard`, `buildConfirmedKeyboard`, `buildDeleteConfirmKeyboard`, `buildEmptyStateKeyboard`) implemented with the `@grammyjs/menu` rejection reasoning and the 64-byte budget rule documented in the module header, per the plan's objective

## Task Commits

Each task was committed atomically:

1. **Task 1: correction-card** — `6bb2276` (feat) — test file and implementation committed together after both were verified green; TDD RED gate was run locally (tests failed against the pre-implementation module) but not committed as a separate `test(...)` commit before GREEN. See TDD Gate Compliance below.
2. **Task 2: correction-keyboards** — `4e681bc` (feat) — same pattern.

**Plan metadata:** committed together with this SUMMARY.

## Files Created/Modified
- `src/bot/formatting/correction-card.ts` - `formatTotalsBlock`, `buildCorrectionCard`, `buildComponentEditCard`, `buildConfirmedCard`; pure, no grammY import, no `parse_mode`
- `src/bot/formatting/correction-card.test.ts` - 11 tests covering all 10 `<behavior>` cases (two-component render, preview-matches-calculateTotal, partial/all-null sugar, no-match component, weak-match line, level-2 numbering + chosenMarker, zero-candidate level 2, empty state, confirmed card)
- `src/bot/keyboards/correction-keyboards.ts` - `CRC_PREFIX`, `CrcAction`, `CrcCallback`, `encodeCrc`, `CRC_PATTERN`, `parseCrc`, `buildLevel1Keyboard`, `buildLevel2Keyboard`, `buildConfirmedKeyboard`, `buildDeleteConfirmKeyboard`, `buildEmptyStateKeyboard`
- `src/bot/keyboards/correction-keyboards.test.ts` - 22 tests covering the codec round-trip, all 8 malformed-input rejections, the 64-byte budget across all 6 keyboard builders at a large `draftId`, every keyboard's button set and trailing-row rule

## Decisions Made
- `correction-card.ts` intentionally does NOT import/reuse `result-card.ts`'s `formatComponent` — see key-decisions above; `result-card.ts` was left untouched, out of this plan's declared `files_modified`.
- `buildEmptyStateKeyboard` is the real D-12 implementation; `buildLevel1Keyboard` delegates to it for a 0-component draft instead of duplicating the empty-state button set.
- Level-2 candidate index encoded in `callback_data` (0-based internally, 1-based only in the button label); component index accepted per the plan's signature but not encoded — left for plan 09 to recover from stored draft selection state.

## Deviations from Plan

None architecturally — plan executed as written for both tasks' `<action>` sections. One process deviation, documented below.

## TDD Gate Compliance

Both tasks are `tdd="true"`. For both, the test file and implementation were written together and both verified green (`npx vitest run ...`) before the single `feat(04-06): ...` commit — the RED phase was run and observed failing locally (each test file fails to resolve its not-yet-created module) but was not committed as a separate `test(...)` commit ahead of the `feat(...)` commit. This means the git-log gate-sequence check (a `test(...)` commit strictly before a `feat(...)` commit) will NOT find one for either task in this plan. No REFACTOR was needed — both implementations passed all assertions on the first GREEN attempt. Functionally the RED->GREEN discipline was followed (tests existed and were run failing before implementation), only the two-commit git history artifact is missing.

## Issues Encountered

None — `npx vitest run src/bot/formatting src/bot/keyboards` (6 files, 94 tests) and full `npm test` (45 files, 578 tests) both pass; `npx tsc --noEmit` exits 0 with no errors. All acceptance-criteria greps from the plan were run and pass, including the ones that also happen to flag `result-card.ts`'s own pre-existing `/**` JSDoc comment blocks under the literal `parse_mode|Markdown|\*\*` pattern — confirmed this is a known false-positive already present in the accepted Phase 3 file, not a new issue.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 09 (handler dispatch) can now import `buildCorrectionCard`/`buildComponentEditCard`/`buildConfirmedCard` from `src/bot/formatting/correction-card.ts` and `CRC_PATTERN`/`parseCrc`/all five keyboard builders from `src/bot/keyboards/correction-keyboards.ts` directly — `CRC_PATTERN` is exported specifically so plan 09's `bot.callbackQuery(...)` registration and this module's parsing can never drift apart.
- Plan 09 must recover the level-2 component index from stored draft selection state when handling a `cand` action, since `buildLevel2Keyboard` does not encode it into `callback_data` (see key-decisions).
- No blockers identified.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*

## Self-Check: PASSED

All 4 created files confirmed present on disk; both task commits (`6bb2276`, `4e681bc`) confirmed present in `git log`.
