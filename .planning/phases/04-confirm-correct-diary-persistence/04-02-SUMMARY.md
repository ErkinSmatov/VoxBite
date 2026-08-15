---
phase: 04-confirm-correct-diary-persistence
plan: 02
subsystem: domain
tags: [typescript, vitest, intl-datetimeformat, arithmetic, timezone]

requires:
  - phase: 01-domain-fdc-foundation
    provides: FdcCandidate nullable-nutrient field shapes (src/domain/fdc-matching/types.ts)
provides:
  - "calculateTotal(items) — the single CALC-01/D-09 nutrient-summation function, full-recompute-from-scratch, missingCount tracked per nutrient key, raw unrounded floats"
  - "deriveLocalDate(instant, timezone) — DIARY-01/D-07 frozen calendar-day derivation via Intl.DateTimeFormat('en-CA'), Postgres date-ready YYYY-MM-DD"
affects: [04-05-message-receipt-and-drafts, 04-06-correction-card, 04-08-diary-persistence]

tech-stack:
  added: []
  patterns:
    - "Nutrient math never coerces a null per-100g value to 0 — it is counted in missingCount and only rendering (later plan) turns that into a user-facing label"
    - "Rounding deferred to render-time only; domain/application layers store raw floats"
    - "deriveLocalDate lives in src/application/, not src/domain/, because its inputs (wall-clock instant, user timezone) are I/O-adjacent even though the function itself is pure"

key-files:
  created:
    - src/domain/nutrition/calculate-total.ts
    - src/domain/nutrition/calculate-total.test.ts
    - src/application/local-date.ts
    - src/application/local-date.test.ts
  modified:
    - src/domain/nutrition/index.ts

key-decisions:
  - "calculateTotal always recomputes from the full items array (never accepts a delta/running total) to guarantee the correction-card preview and the saved diary total can never drift apart (D-03)"
  - "deriveLocalDate throws on an unknown IANA timezone instead of falling back to the process timezone, so a misconfigured user row fails loudly instead of silently filing a meal under the wrong day"

patterns-established:
  - "Pattern: domain arithmetic functions accept a plain array of primitive-typed items (TotalInputItem) rather than importing FdcCandidate/DraftComponent directly, keeping src/domain/ free of inward dependencies on src/application/"

requirements-completed: [CALC-01, CALC-02, DIARY-01]

duration: 20min
completed: 2026-08-14
---

# Phase 04 Plan 02: Nutrient Total & Local-Date Domain Functions Summary

**`calculateTotal()` (single CALC-01/D-09 nutrient-summation function with null-safe missingCount) and `deriveLocalDate()` (D-07 timezone-correct calendar day via `Intl.DateTimeFormat('en-CA')`) — both pure, both TDD'd, zero DB/grammY/LLM imports.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-08-14T19:13:00Z
- **Completed:** 2026-08-14T19:15:42Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `calculateTotal()` is now the only nutrient-summation implementation in the repo, re-exported through `src/domain/nutrition/index.ts`, honoring D-09 (a null per-100g value is counted in `missingCount`, never summed as 0; an all-null nutrient across every component returns `null`)
- `deriveLocalDate()` converts a receipt-time `Date` plus a user's IANA timezone string into a Postgres-ready `YYYY-MM-DD`, throwing a descriptive error (naming the offending timezone) instead of silently falling back to the process's local timezone
- Recompute-invariance regression test locks in that `calculateTotal` never accepts an incremental/running total — a +10/-10/+10-gram sequence, recomputed from scratch each time, equals one direct computation at the final grams

## Task Commits

Each task was committed atomically (TDD RED → GREEN per task):

1. **Task 1: calculateTotal** — `5866206` (test: failing coverage), `688cbbb` (feat: implementation + barrel export)
2. **Task 2: deriveLocalDate** — `db8b4fc` (test: failing coverage), `ce0f546` (feat: implementation)

**Plan metadata:** committed together with this SUMMARY.

_TDD tasks: no refactor commit needed — both implementations passed on first GREEN attempt with no cleanup required._

## Files Created/Modified
- `src/domain/nutrition/calculate-total.ts` - `calculateTotal(items)` + `TotalInputItem`/`NutrientTotal` types; per-item `(grams/100)*per100gValue`, null-safe `missingCount`, raw unrounded floats
- `src/domain/nutrition/calculate-total.test.ts` - full-data, one-null-per-nutrient, all-null, empty-array, recompute-invariance, and invalid-input cases
- `src/application/local-date.ts` - `deriveLocalDate(instant, timezone)` via `Intl.DateTimeFormat('en-CA', { timeZone })`, throws on invalid `Date` or unknown IANA zone
- `src/application/local-date.test.ts` - D-07 late-evening boundary case, UTC round-trip, zero-padded format across 3 IANA zones, garbage-timezone and invalid-Date rejection
- `src/domain/nutrition/index.ts` - barrel now re-exports `calculateTotal`, `NutrientTotal`, `TotalInputItem`

## Decisions Made
- Rounding is explicitly deferred to render time (formatter, plan 06) — this file's header comment states the rule so later plans do not each invent their own rounding convention (04-RESEARCH.md Open Question 2)
- `deriveLocalDate` lives in `src/application/`, not `src/domain/`, per 04-RESEARCH.md's Architectural Responsibility Map — the function is pure but its inputs (wall-clock instant, user timezone) are I/O-adjacent

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Both tasks passed acceptance-criteria greps and `npx tsc --noEmit` on the first implementation pass; no auto-fix cycles were needed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 05 (message receipt/drafts) can call `deriveLocalDate` once at receipt time and persist the result, per D-07
- Plan 06 (correction card) and plan 08 (diary persistence) both import `calculateTotal` from the `src/domain/nutrition` barrel — no second summation implementation should ever be written; later plans' acceptance criteria should `grep` to enforce this
- No blockers identified

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-14*

## Self-Check: PASSED

All created files verified present; all 4 task commit hashes verified present in git log.
