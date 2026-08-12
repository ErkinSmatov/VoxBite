---
phase: 03-voice-pipeline
plan: 05
subsystem: application
tags: [drizzle, postgres, tdd, spend-control, idempotency]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: "src/db/schema/processed-updates.ts, src/db/schema/users.ts (plan 03-02); src/application/types.ts DAILY_MESSAGE_CAP (plan 03-03)"
provides:
  - "src/application/idempotency.ts: claimUpdate, markUpdateStatus, findInterruptedUpdates, markInterrupted"
  - "src/application/limits.ts: countRecentUpdates, isDailyCapReached, findOnboardedUser"
affects: [03-voice-pipeline plans 06-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotency claim via insert().onConflictDoNothing({target}).returning() -- database-enforced, not application-level dedup"
    - "Fail-open guard: a limit check that fails MUST return false (permit), not throw or block, so a database hiccup in a non-financial guard cannot deny a legitimate user"

key-files:
  created:
    - src/application/idempotency.ts
    - src/application/idempotency.test.ts
    - src/application/limits.ts
    - src/application/limits.test.ts
  modified: []

key-decisions:
  - "countRecentUpdates computes the window cutoff in JavaScript (new Date(Date.now() - windowHours*3600_000)) rather than SQL date arithmetic, to match the (telegram_id, created_at) index shape exactly"
  - "isDailyCapReached's catch logs a fixed Russian line naming only the failure kind -- no telegram id, no message content -- matching src/bot/error-handler.ts's logging invariant"

patterns-established:
  - "Pattern: fake-db unit tests tag drizzle-orm's eq/gte/and/inArray with a mock that returns { kind, column, value } objects, then compare by column *identity* (the real exported schema column reference) rather than guessed string keys -- keeps tests hermetic without weakening the assertion to 'some condition was passed'"

requirements-completed: [VOICE-04]

duration: ~20min
completed: 2026-08-12
---

# Phase 3 Plan 05: Idempotency and Runaway-Limit Guards Summary

**The two database-backed guards that must run before any paid API call: `claimUpdate`'s onConflictDoNothing idempotency claim over `processed_updates`, and `isDailyCapReached`'s fail-open rolling-24h runaway cap, plus `findOnboardedUser`'s pre-draft onboarding check**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-12T11:38:00Z
- **Completed:** 2026-08-12T11:41:30Z
- **Tasks:** 2 completed (both TDD: RED then GREEN)
- **Files modified:** 4 created

## Accomplishments

- `src/application/idempotency.ts` implements the phase's main spend control: `claimUpdate` inserts a `processed_updates` row with `onConflictDoNothing({ target: processedUpdates.updateId }).returning(...)`, returning `true` only when this call won the race — a duplicate Telegram delivery is rejected by the database itself, before any paid call, with no further query issued on rejection.
- `markUpdateStatus`, `findInterruptedUpdates` and `markInterrupted` implement the D-11 crash-recovery sweep: a row still in `'processing'` at startup is findable and can be moved to a terminal `'interrupted'` status — deliberately with no resume path anywhere in the module (the source audio is gone by design, D-05).
- `src/application/limits.ts` implements `countRecentUpdates`/`isDailyCapReached` (D-15's rolling-24h runaway guard against `DAILY_MESSAGE_CAP`, imported from `types.ts` with no numeric literal 30 in the module) and `findOnboardedUser` (turns a would-be foreign-key crash on `diary_drafts.user_id` into an immediate, actionable check before any spend).
- Both modules import no `grammy` and hold no module-level state, per `src/application/types.ts`'s two hard rules.

## Task Commits

Each task followed the RED -> GREEN TDD cycle and was committed atomically:

1. **Task 1: processed_updates claim, status and interrupted-sweep functions**
   - RED: `6daae27` (test) — failing tests for `claimUpdate`/`markUpdateStatus`/`findInterruptedUpdates`/`markInterrupted`
   - GREEN: `b4cea54` (feat) — implementation, 8/8 tests passing
2. **Task 2: Per-user daily cap and onboarded-user lookup**
   - RED: `306adf9` (test) — failing tests for `countRecentUpdates`/`isDailyCapReached`/`findOnboardedUser`
   - GREEN: `c408880` (feat) — implementation, 9/9 tests passing

## Files Created/Modified

- `src/application/idempotency.ts` — `claimUpdate`, `markUpdateStatus`, `findInterruptedUpdates`, `markInterrupted`
- `src/application/idempotency.test.ts` — 8 tests, hand-built fake `db` (structural stub, no real Postgres connection), asserting call counts (not just return values) to prove "returns false" and "returns false without issuing another query" are separately verified
- `src/application/limits.ts` — `countRecentUpdates`, `isDailyCapReached`, `findOnboardedUser`
- `src/application/limits.test.ts` — 9 tests, same fake-db approach, covering the three cap boundary cases (`DAILY_MESSAGE_CAP - 1`, `= DAILY_MESSAGE_CAP`, `> DAILY_MESSAGE_CAP`) and the fail-open case where the count query rejects

## Decisions Made

- `countRecentUpdates` uses a rolling 24-hour window computed in JavaScript, not a calendar day — documented inline: calendar-day semantics need the user's timezone, which is a Phase 4/diary concern, and "roughly a day" is precise enough for a runaway guard (D-15).
- `isDailyCapReached` fails open (`false`) on any query error, logging one fixed Russian line naming only the failure kind — never the telegram id or message content — matching `src/bot/error-handler.ts`'s existing logging invariant (T-03-25). Real spend protection remains with `claimUpdate` and the pipeline's 60s duration cap, so failing open here cannot itself cause runaway spend.
- Test doubles mock `drizzle-orm`'s `eq`/`gte`/`and`/`inArray` to return tagged `{ kind, column, value }` objects and compare by column *identity* against the real exported schema column references (`processedUpdates.updateId`, `users.telegramId`, etc.) rather than guessed string keys — this is stricter than a loose "some condition was passed" assertion while staying fully hermetic (no real database connection).

## Deviations from Plan

None — plan executed exactly as written. Both task read_first files (`pg-storage-adapter.ts`/`.test.ts`, `start.ts`, `03-RESEARCH.md` Pattern 4) were consulted and their shapes (factory functions taking `db` as an argument, the `onConflictDoNothing().returning()` sketch, the `select().from(users).where(eq(...)).limit(1)` lookup shape) were followed directly.

## Known Stubs

None. Both modules are complete, fully tested, and exported for plans 03-06/07/08 to import.

## Threat Flags

None beyond what the plan's own `<threat_model>` already tracks (T-03-22 through T-03-28) — no new network endpoints, auth paths, or trust-boundary surface introduced beyond the two application-layer modules already scoped there.

## Verification

- `npx vitest run src/application/` — 2 test files, 17 tests, all passing
- `npm run typecheck` — exits 0
- `npm test` — full suite, 30 test files, 397 tests, all passing
- `grep -rln "from 'grammy'" src/application/` — no results

## TDD Gate Compliance

Both tasks followed the full RED -> GREEN cycle: a `test(...)` commit with a confirmed-failing suite (module did not exist yet), followed by a `feat(...)` commit making all tests pass. No REFACTOR commit was needed — the GREEN implementation required no cleanup pass.

## Self-Check: PASSED

- FOUND: src/application/idempotency.ts
- FOUND: src/application/idempotency.test.ts
- FOUND: src/application/limits.ts
- FOUND: src/application/limits.test.ts
- FOUND commit 6daae27
- FOUND commit b4cea54
- FOUND commit 306adf9
- FOUND commit c408880

---
*Phase: 03-voice-pipeline*
*Completed: 2026-08-12*
