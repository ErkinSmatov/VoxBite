---
phase: 03-voice-pipeline
plan: 07
subsystem: bot
tags: [grammy, spend-control, idempotency, tdd, vitest]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: "src/application/voice-pipeline.ts processMeal/PipelineDeps/ProcessMealArgs (plan 06); src/application/idempotency.ts claimUpdate/markUpdateStatus and src/application/limits.ts isDailyCapReached/findOnboardedUser (plan 05); src/application/types.ts MessageEditor and src/bot/formatting/pipeline-copy.ts (plan 03); src/adapters/stt/types.ts MAX_VOICE_SECONDS (plan 01)"
provides:
  - "src/bot/telegram/download-voice.ts: downloadVoice(ctx, token) — in-memory voice fetch with the pre-download duration cap (D-14), VoiceTooLongError, VoiceUnavailableError"
  - "src/bot/telegram/message-editor.ts: createMessageEditor(api) — the grammY-backed MessageEditor implementation"
  - "src/bot/handlers/meal.ts: createVoiceHandler, createTextHandler, createUnsupportedHandler, MAX_TEXT_LENGTH — the gated, claimed, acknowledged, detached entry points into processMeal"
affects: [03-voice-pipeline plan 08 (registers these three handlers into bot.ts, plus the startup interrupted-update sweep)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structural ctx typing (VoiceDownloadContext, EditableApi) mirrors ack.ts — every new bot-layer helper stays unit-testable with a two-line fake instead of a real grammY Context"
    - "MealHandlerDeps carries optional overrides for every injected function (claimUpdate, markUpdateStatus, findOnboardedUser, isDailyCapReached, downloadVoice, processMeal), defaulting to the real implementations — same seam createOpenAIEmbedder uses for its client"
    - "Gate order (claim -> onboarding -> daily cap -> download/duration-cap -> ack -> detached processMeal) is written once in meal.ts's module doc comment and enforced identically by both createVoiceHandler and createTextHandler"

key-files:
  created:
    - src/bot/telegram/download-voice.ts
    - src/bot/telegram/download-voice.test.ts
    - src/bot/telegram/message-editor.ts
    - src/bot/handlers/meal.ts
    - src/bot/handlers/meal.test.ts

key-decisions:
  - "downloadVoice's ordering matches 03-RESEARCH.md Pattern 1 exactly: voice.duration is checked against MAX_VOICE_SECONDS (imported from src/adapters/stt/types.ts, no literal 60) BEFORE ctx.getFile() is ever called, so an over-length voice costs literally nothing"
  - "createMessageEditor accepts an EditableApi structural type (only editMessageText) rather than grammY's Api type, keeping src/application/ importable with zero grammY types even though the concrete adapter lives in src/bot/"
  - "MealHandlerDeps.deps is a nested PipelineDeps object per the plan's own interface contract, kept separate from db/token which the handlers themselves need for claim/gate queries and the download URL"
  - "Text handler bounds MAX_TEXT_LENGTH by truncation (slice), not refusal — a pasted essay is a benign accident, not intentional abuse, and truncating still bounds LLM spend per message"

patterns-established:
  - "Pattern: every gate (claimUpdate, findOnboardedUser, isDailyCapReached) returns/throws early with an immediate reply-and-mark before the next gate runs — no gate is ever skipped by falling through, and each early-return path is independently unit-tested"

requirements-completed: [VOICE-01, VOICE-02, VOICE-04]

duration: 65min
completed: 2026-08-12
---

# Phase 3 Plan 07: Telegram-Facing Edge — Voice Download, MessageEditor, Gated Handlers Summary

**The Telegram-facing edge of the voice pipeline: in-memory voice download with its pre-download duration cap, the grammY-backed `MessageEditor`, and the voice/text/unsupported handlers that gate on idempotency + onboarding + daily cap before acknowledging and detaching into `processMeal` — everything that costs money sits behind this file.**

## Performance

- **Duration:** ~65 min (including `npm install` for this worktree's isolated `node_modules`)
- **Tasks:** 2 completed, both TDD (RED confirmed failing before implementation, then GREEN)
- **Files created:** 5

## Accomplishments

- `src/bot/telegram/download-voice.ts` — `downloadVoice(ctx, token)`: checks `voice.duration` against `MAX_VOICE_SECONDS` (imported, no literal `60`) BEFORE `getFile()`, so an over-length voice never touches Telegram's file API (D-14); fetches the file directly into a `Buffer`, never writes to disk (D-05); the bot token embedded in the download URL never appears in a log or a thrown error message (T-03-41), verified by dedicated tests
- `src/bot/telegram/message-editor.ts` — `createMessageEditor(api)`: the grammY-backed `MessageEditor` (plan 03-03's port), sending plain text with no `parse_mode`
- `src/bot/handlers/meal.ts` — `createVoiceHandler`, `createTextHandler`, `createUnsupportedHandler`, `MAX_TEXT_LENGTH`: the exact gate order `claimUpdate -> findOnboardedUser -> isDailyCapReached -> [voice] downloadVoice -> ack -> detached processMeal`, matching the plan's threat model line for line; `createUnsupportedHandler` (D-06) claims nothing, downloads nothing, costs nothing

## Task Commits

Both tasks followed the RED -> GREEN TDD cycle and were committed atomically:

1. **Task 1: In-memory voice download with the pre-download duration cap, and the MessageEditor**
   - RED: `8d6d26e` (test) — 8 tests for `download-voice.ts`/`message-editor.ts`, confirmed failing (`Cannot find module './download-voice.js'`) before the modules existed
   - GREEN: `6ae28b1` (feat) — `download-voice.ts` + `message-editor.ts` implemented, all 8 tests pass
2. **Task 2: Voice, text and unsupported-message handlers**
   - RED: `a3428a2` (test) — 14 tests for `meal.ts`, confirmed failing (`Cannot find module './meal.js'`) before the module existed
   - GREEN: `0ac3bf3` (feat) — `meal.ts` implemented; two order-assertion tests needed a `Promise.resolve()`/slice fix to observe the detached `processMeal` call correctly, all 14 pass

## TDD Gate Compliance

Both tasks followed the full RED -> GREEN cycle:
- Task 1: `8d6d26e` (test, confirmed failing via a temporary file-move + re-run) -> `6ae28b1` (feat, 8/8 green). No refactor needed.
- Task 2: `a3428a2` (test, confirmed failing the same way) -> `0ac3bf3` (feat, 14/14 green after fixing two test-side ordering assertions to allow the detached-promise microtask to run). No separate refactor commit — the fix was bundled into the GREEN commit since it corrected the test's own timing assumption, not the implementation.

## Files Created/Modified

- `src/bot/telegram/download-voice.ts` — `downloadVoice`, `VoiceTooLongError`, `VoiceUnavailableError`, `VoiceDownloadContext`
- `src/bot/telegram/download-voice.test.ts` — 8 tests (7 for `downloadVoice`, 1 for `createMessageEditor`)
- `src/bot/telegram/message-editor.ts` — `createMessageEditor`, `EditableApi`
- `src/bot/handlers/meal.ts` — `createVoiceHandler`, `createTextHandler`, `createUnsupportedHandler`, `MAX_TEXT_LENGTH`, `MealHandlerDeps`
- `src/bot/handlers/meal.test.ts` — 14 tests covering every behaviour bullet with a fake `ctx` and injected fakes for every gate/downstream call

## Decisions Made

- Followed 03-RESEARCH.md Pattern 1's verified `downloadVoice` implementation shape directly, adapting only the `ctx` type to the plan's own `VoiceDownloadContext` interface (structurally typed, matching `ack.ts`'s convention) instead of importing `BotContext` into this file
- `MealHandlerDeps` exposes every injected dependency (`claimUpdate`, `markUpdateStatus`, `findOnboardedUser`, `isDailyCapReached`, `downloadVoice`, `processMeal`) as an optional override defaulting to the real module export — this is what let `meal.test.ts` assert exact call order without constructing a real `Db` or grammY `Bot`
- `resolveIds(ctx)` centralizes the "no `from.id`/`chat.id`" defensive check (logs a short line, returns null) so both `createVoiceHandler` and `createTextHandler` share one implementation rather than duplicating the guard

## Deviations from Plan

None. Both tasks were implemented exactly per 03-07-PLAN.md's `<action>` blocks and `03-RESEARCH.md`'s Pattern 1/Pattern 5 sketches. The only in-flight correction was to two of my own test assertions (order arrays asserted before the detached `processMeal` promise's microtask had a chance to run) — a test-authoring bug caught and fixed during the same GREEN pass, not a plan deviation.

## Issues Encountered

- This worktree had no `node_modules` (isolated worktree, gitignored, matching 03-04/03-06's precedent). Ran `npm install` before starting Task 1; `package-lock.json` picked up the same cosmetic re-normalization noted in prior plan summaries — reverted with `git checkout -- package-lock.json` before finishing, never staged in any task commit.
- This worktree's `main` history did not initially contain the orchestrator's merge commit `76702c16e8a20c4cc1b585ab5a566d573bf0c4fa` (03-06's summary + application-layer files). Per the branch-check protocol, reset the worktree branch to that commit before starting any work, so this plan builds directly on plan 06's `processMeal`/`PipelineDeps` as intended.

## User Setup Required

None — no external service configuration required. No new environment variable added. Registration of these handlers into `bot.ts` (and the constructed adapters wiring `PipelineDeps`) is plan 03-08's job, not this plan's.

## Known Stubs

None. Both new files are complete, fully tested (22 new tests total), and exported for plan 03-08 to import and register. No unwired branch: every documented gate outcome (claim-lost, not-onboarded, daily-cap, too-long, download-error, happy-path) has a concrete, tested implementation.

## Threat Flags

None beyond what the plan's own `<threat_model>` already tracks (T-03-37 through T-03-45) — this plan closes each of those threats exactly as scoped (duration cap before download, claim as first effectful statement, bounded text length, zero-cost unsupported-type refusal, token/ctx never logged, detached-but-caught pipeline promise). No new network endpoints, auth paths, or trust-boundary surface introduced beyond what the plan's threat register already scoped.

## Verification

- `npx vitest run src/bot/telegram/download-voice.test.ts src/bot/handlers/meal.test.ts` — 2 test files, 22 tests, all passing
- `npm run typecheck` — exits 0
- `npm test` — full suite, 36 test files, 471 tests, all passing
- `grep -rn "writeFile" src/bot/telegram/` — no results
- `grep -c "from 'fs'\|from 'node:fs'\|writeFile" src/bot/telegram/download-voice.ts` — 0
- `grep -n "console.log(ctx\|console.error(ctx\|JSON.stringify(ctx" src/bot/handlers/meal.ts` — no results
- `grep -n "void processMeal(" src/bot/handlers/meal.ts` followed by `.catch(` on the same expression — confirmed in both handlers

## Next Phase Readiness

- `createVoiceHandler`, `createTextHandler`, `createUnsupportedHandler` are ready for plan 03-08 to register into `bot.ts` (for `message:voice`, `message:text`, and `message:audio`/`video_note`/`photo`/`document`/`sticker`/`video` respectively) and to wire with the real constructed `PipelineDeps` and `createMessageEditor(bot.api)`
- Plan 03-08's startup sweep (`findInterruptedUpdates`/`markInterrupted`, D-11) has no dependency on this plan's files and can proceed independently
- No blockers identified

---
*Phase: 03-voice-pipeline*
*Completed: 2026-08-12*

## Self-Check: PASSED

- FOUND: src/bot/telegram/download-voice.ts
- FOUND: src/bot/telegram/download-voice.test.ts
- FOUND: src/bot/telegram/message-editor.ts
- FOUND: src/bot/handlers/meal.ts
- FOUND: src/bot/handlers/meal.test.ts
- FOUND commit 8d6d26e
- FOUND commit 6ae28b1
- FOUND commit a3428a2
- FOUND commit 0ac3bf3
