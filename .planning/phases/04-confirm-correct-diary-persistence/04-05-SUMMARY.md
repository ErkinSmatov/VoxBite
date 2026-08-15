---
phase: 04-confirm-correct-diary-persistence
plan: 05
subsystem: voice-pipeline / meal handlers
tags: [diary, timezone, D-07]
dependency-graph:
  requires: [04-01, 04-02]
  provides: [findOnboardedUser-timezone, processMeal-localDate]
  affects: [04-08]
tech-stack:
  added: []
  patterns:
    - "Derive local_date once, at draft-save time, from the message's own timestamp — never new Date()"
key-files:
  created: []
  modified:
    - src/application/limits.ts
    - src/application/limits.test.ts
    - src/application/voice-pipeline.ts
    - src/application/voice-pipeline.test.ts
    - src/bot/handlers/meal.ts
    - src/bot/handlers/meal.test.ts
decisions:
  - "findOnboardedUser widened to return { id, timezone } instead of adding a second query at confirm time -- the handlers already run this query before any paid call, so the timezone travels for free"
  - "Missing/zero ctx.message.date falls back to new Date() with an operator log line naming only the update id, rather than blocking the meal"
metrics:
  duration: "~25m"
  completed: "2026-08-15"
---

# Phase 4 Plan 05: Freeze the diary day at message receipt (D-07) Summary

Carries the Telegram message's own timestamp and the user's IANA timezone into the voice
pipeline so `diary_drafts.local_date` is computed exactly once, at draft-save time, from
`deriveLocalDate(receivedAt, timezone)` — never from the wall clock the pipeline happens to
run on.

## What Changed

**`src/application/limits.ts`** — `findOnboardedUser` now returns
`{ id, timezone } | null` instead of `{ id } | null`. No hardcoded `Asia/Almaty` fallback in
application code; `users.timezone` is `NOT NULL` with a database default, so a null value would
be a schema regression that should fail loudly at `deriveLocalDate`, not be silently patched
over here.

**`src/application/voice-pipeline.ts`** — `ProcessMealArgs` gains `receivedAt: Date` and
`timezone: string`. `processMeal` derives `localDate = deriveLocalDate(args.receivedAt,
args.timezone)` inside the same try block that already wraps the persist-and-render stage,
immediately before `saveDraft`, and writes it onto the row. A thrown `deriveLocalDate` (unknown
IANA zone) is caught by the pre-existing `handleLateFailure` path — no new catch was added, and
the pipeline's "never rejects" contract holds.

**`src/bot/handlers/meal.ts`** — Both `createVoiceHandler` and `createTextHandler` resolve
`receivedAt` from `ctx.message.date` (Unix seconds → `Date`), falling back to `new Date()` with
a one-line operator log (update id only) if the field is missing or zero, and pass
`timezone: user.timezone` from the `findOnboardedUser` result already in scope at gate 2. The
numbered gate comments and gate order in both handlers are unchanged.

## Deviations from Plan

### Auto-fixed / Clarified

**1. [Not a deviation, clarification] The `deriveLocalDate` grep acceptance criterion literally
returns 2, not 1**
- The plan's automated check `grep -v '^\s*[*/]' src/application/voice-pipeline.ts | grep -c
  "deriveLocalDate"` expects exactly 1. In practice this file needs an `import { deriveLocalDate
  } from './local-date.js';` line plus the one call site, so the substring "deriveLocalDate"
  necessarily appears on 2 lines (import + call) — an import statement is unavoidable to use the
  function at all. Verified manually with `grep -n "deriveLocalDate" src/application/voice-pipeline.ts`
  that there is exactly ONE call site (`const localDate = deriveLocalDate(args.receivedAt, args.timezone);`
  at line 270) and one import (line 55) — the actual invariant the criterion cares about
  ("derived in one place only") holds. Did not contrive a dynamic `import()` at the call site to
  force the literal grep count to 1, since that would be inconsistent with every other static
  import in this codebase for no real benefit.
- All other acceptance criteria (the `new Date()` non-increase check, the `receivedAt` count in
  meal.ts, gate-order preservation, test suites, `tsc --noEmit`) pass exactly as written.

None of the plan's substantive behaviour was changed — this is a note about one grep pattern's
literal wording, not a functional gap.

## Test Coverage Added

- `limits.test.ts`: `findOnboardedUser` returns `{ id, timezone }`, carries a non-default
  timezone through unchanged, and the null-return cases are preserved.
- `voice-pipeline.test.ts`: the saved draft's `localDate` matches `deriveLocalDate(receivedAt,
  timezone)`; the D-07 motivating case (a just-after-local-midnight `Asia/Almaty` instant that a
  naive UTC-date read would misfile under the previous day); `processMeal` never rejects when
  `deriveLocalDate` throws on an invalid timezone — it routes through the existing late-failure
  path (`saveDraft` never called, ack edited to `internalError`, status `failed`).
- `meal.test.ts`: both handlers pass `receivedAt` derived from `ctx.message.date * 1000` and the
  `timezone` from the faked `findOnboardedUser`; the missing/zero-`date` fallback does not throw
  and logs one operator line.

## Verification

- `npx vitest run src/application/limits.test.ts` — 11 passed.
- `npx vitest run src/application/voice-pipeline.test.ts src/bot/handlers/meal.test.ts` — 37 passed.
- `npx vitest run src/application src/bot/handlers` — 72 passed.
- `npm test` (full suite) — 551 passed, 43 files, no regressions.
- `npx tsc --noEmit` — exits 0.

## Self-Check: PASSED

- `src/application/limits.ts` — FOUND, modified.
- `src/application/voice-pipeline.ts` — FOUND, modified.
- `src/bot/handlers/meal.ts` — FOUND, modified.
- Commit `3dd6176` (findOnboardedUser timezone) — FOUND in `git log`.
- Commit `58a62cf` (D-07 freeze) — FOUND in `git log`.
