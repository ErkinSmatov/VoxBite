---
phase: 03-voice-pipeline
plan: 03
subsystem: api
tags: [typescript, zod-free-types, vitest, tdd, hexagonal-ports]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: "src/domain/fdc-matching (FdcCandidate, CANDIDATE_COUNT) from Phase 3 plan 01/02"
provides:
  - "src/application/types.ts: MealDraft, DraftComponent, DecomposedComponent, MessageEditor, PipelineFailure, WEAK_MATCH_SIMILARITY_THRESHOLD, DAILY_MESSAGE_CAP, isWeakMatch()"
  - "src/bot/formatting/pipeline-copy.ts: every Russian user-facing string of the voice pipeline"
  - "src/bot/formatting/result-card.ts: buildResultCard(draft) read-only D-18 card renderer"
affects: [03-voice-pipeline plans 04-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "src/application/ layer established: orchestration between bot transport and adapters/domain, never imports grammy, never holds state in module memory"
    - "isWeakMatch() as single exported pure function shared by pipeline and card so the weak-match flag can never drift between what's computed and what's shown"

key-files:
  created:
    - src/application/types.ts
    - src/bot/formatting/pipeline-copy.ts
    - src/bot/formatting/result-card.ts
    - src/bot/formatting/result-card.test.ts
  modified: []

key-decisions:
  - "WEAK_MATCH_SIMILARITY_THRESHOLD = 0.7 documented as a first guess to be tuned against real transcripts, not a validated number"
  - "DAILY_MESSAGE_CAP = 30 documented explicitly as a runaway-processing guard (D-15), not a subscription tariff"
  - "Result card sent as plain text with no parse_mode — no escaping helper needed, so an FDC description containing _ or * cannot break rendering (also closes threat T-03-12)"

patterns-established:
  - "Pattern: application/ layer types are the single authoritative contract definition — downstream plans import, never redefine"
  - "Pattern: derived flags (weakMatch) computed by one exported pure function, not duplicated in each consumer"

requirements-completed: [DECOMP-01, VOICE-02]

duration: 15min
completed: 2026-08-12
---

# Phase 3 Plan 3: Voice Pipeline Contracts and Result Card Summary

**Shared MealDraft/DraftComponent contracts plus a plain-text, no-nutrient-numbers Russian result card that flags weak FDC matches instead of dropping them**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-12T11:14:00Z
- **Completed:** 2026-08-12T11:29:00Z
- **Tasks:** 2 completed
- **Files modified:** 4 created

## Accomplishments
- `src/application/types.ts` establishes the orchestration layer's shared contracts (`MealDraft`, `DraftComponent`, `DecomposedComponent`, `MessageEditor`, `PipelineFailure`) with the weak-match threshold and daily cap constants, plus `isWeakMatch()` as the single source of truth for the weak-match flag
- `pipeline-copy.ts` collects every Russian string the voice pipeline can show a user in one reviewable module, covering all nine terminal outcomes plus the shared acknowledgement text
- `result-card.ts` renders the D-18 read-only card: verbatim FDC descriptions, flags weak matches and no-candidate components instead of dropping them (D-21), shows no nutrient numbers (D-20), and never leaks candidates 2/3 or a similarity score

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared pipeline contracts in src/application/types.ts** - `ae1dace` (feat)
2. **Task 2: Russian copy module and the read-only result card** - TDD cycle:
   - RED: `7d25cce` (test) - failing tests for `buildResultCard` and `pipelineCopy`
   - GREEN: `bc5c36b` (feat) - implementation makes all 20 tests pass

**Plan metadata:** (this commit, immediately following)

## Files Created/Modified
- `src/application/types.ts` - MealDraft/DraftComponent/MessageEditor contracts, WEAK_MATCH_SIMILARITY_THRESHOLD (0.7), DAILY_MESSAGE_CAP (30), isWeakMatch()
- `src/bot/formatting/pipeline-copy.ts` - every Russian string of the voice pipeline (ack, noFood, sttFailed, decompositionFailed, internalError, tooLong, dailyCapReached, unsupportedMessage, interruptedByRestart, notOnboarded)
- `src/bot/formatting/result-card.ts` - buildResultCard(draft): pure function rendering the read-only card
- `src/bot/formatting/result-card.test.ts` - 20 tests covering both result-card.ts and pipeline-copy.ts

## Decisions Made
- `WEAK_MATCH_SIMILARITY_THRESHOLD = 0.7` — no prior phase established this number, documented inline as a first guess for later tuning against real transcripts
- `DAILY_MESSAGE_CAP = 30` — documented as a runaway-guard, not a tariff limit (tariffs deferred to v2 per PROJECT.md)
- Card sent as plain text (no `parse_mode`) — avoids needing a Telegram-markup escaping helper and closes threat T-03-12 (rendering injection) by construction

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript's `noUncheckedIndexedAccess`-style strictness flagged `candidates[0]` as possibly undefined in both `isWeakMatch()` and the test fixtures — resolved with a local `const top = candidates[0]` guard in `isWeakMatch()` and non-null assertions (`!`) in test fixture helpers where the array is constructed inline and known non-empty.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plans 04-08 can now import `MealDraft`, `DraftComponent`, `MessageEditor` and `pipelineCopy`/`buildResultCard` without inventing their own shapes
- `src/application/` directory exists with its two hard rules (no grammY import, no in-memory state) documented in the module doc comment for future plans to follow
- No blockers identified

---
*Phase: 03-voice-pipeline*
*Completed: 2026-08-12*

## Self-Check: PASSED

All created files verified present on disk; all three task commits (ae1dace, 7d25cce, bc5c36b) verified present in git log.
