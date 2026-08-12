---
phase: 03-voice-pipeline
plan: 06
subsystem: application
tags: [orchestration, hexagonal, tdd, vitest, drizzle]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: "src/adapters/stt (plan 01), src/db/schema/diary-drafts+processed-updates (plan 02), src/application/types+pipeline-copy+result-card (plan 03), src/adapters/llm DishDecomposer widened to DecompositionResult (plan 04, orchestrator-corrected on this worktree's base commit), src/application/idempotency+limits (plan 05)"
provides:
  - "src/application/voice-pipeline.ts: processMeal(deps, args) — the single Telegram-agnostic orchestrator for both voice and text"
  - "src/application/draft-store.ts: saveDraft(db, row) — the diary_drafts write"
  - "src/application/cost-log.ts: buildCostLine()/logCost() — the D-17 per-message terminal line"
affects: [03-voice-pipeline plans 07-08 (bot-layer wiring, MessageEditor implementation, startup sweep)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "processMeal branches on input.kind ONLY to decide whether transcriber.transcribe runs — every step after the transcript exists is identical code for voice and text (VOICE-04 enforced by code structure, not by convention)"
    - "finish() helper: single terminal-failure path that edits the ack message, marks the ledger row, and logs one failure-kind+update-id line, swallowing its own errors so processMeal can never reject"
    - "CostInputs has no transcript/component-text field — the D-17 no-leak guarantee is a missing field, not a redaction step"

key-files:
  created:
    - src/application/cost-log.ts
    - src/application/cost-log.test.ts
    - src/application/draft-store.ts
    - src/application/voice-pipeline.ts
    - src/application/voice-pipeline.test.ts

key-decisions:
  - "Consumed the orchestrator's base-commit correction to plan 03-04's DishDecomposer port (decompose(): Promise<DecompositionResult>) rather than the plan text's original Promise<Decomposition> — real LLM usage/model now flow into the D-17 cost line instead of degrading to the unknown-tokens fallback on every call"
  - "Embedding cost in buildCostLine uses a rough average-tokens-per-short-food-name constant (6) rather than estimateEmbeddingCostUsd's char-based estimate, because CostInputs deliberately carries only embeddedCount (a number), never the embedded strings themselves — the tradeoff is a coarser dollar figure in exchange for a structural guarantee that no component name can ever reach this file"
  - "markUpdateStatus and saveDraft are called directly from voice-pipeline.ts (not re-exposed through PipelineDeps) — matches the plan's own acceptance criteria ('voice-pipeline.ts ... contains saveDraft, markUpdateStatus, logCost') and keeps PipelineDeps limited to the six ports that actually vary by environment (db, transcriber, decomposer, embedder, repo, editor)"

patterns-established:
  - "Pattern: a function that runs as a detached promise (no caller ever awaits or catches it) wraps its entire body in try/catch and funnels every failure through one finish()-style helper that itself never throws — the correct shape for 03-RESEARCH.md Pitfall 6's 'never reject' requirement"

requirements-completed: [VOICE-03, VOICE-04, DECOMP-01, DECOMP-02, DECOMP-03]

duration: 55min
completed: 2026-08-12
---

# Phase 3 Plan 06: processMeal — the single voice/text orchestrator, draft writer, cost line Summary

**`processMeal()` turns an audio Buffer or typed string into a persisted `diary_drafts` row and an in-place-edited result card, batching embeddings into one call, matching in parallel through the domain barrel, flagging weak/absent matches instead of dropping them, and never rejecting on any failure path — plus the D-17 cost line and D-19 draft writer it depends on.**

## Performance

- **Duration:** ~55 min (including `npm install` for this worktree's isolated `node_modules`)
- **Tasks:** 2 completed, both TDD (RED confirmed failing before implementation, then GREEN)
- **Files created:** 5

## Accomplishments

- `src/application/cost-log.ts` — `buildCostLine`/`logCost` (D-17): one line per processed message reporting STT seconds, LLM input/output tokens, embedded-string count, component count and a >=4-decimal dollar total; degrades to a `неизвестно` marker on an unrecognised `usage` shape instead of throwing; `CostInputs` has no field capable of carrying a transcript or component name
- `src/application/draft-store.ts` — `saveDraft(db, row)` (D-19): single Drizzle insert into `diary_drafts` returning the new id
- `src/application/voice-pipeline.ts` — `processMeal(deps, args)`: the single orchestrator described in 03-RESEARCH.md's architecture diagram, implementing VOICE-04 (voice/text share every step after the transcript exists), D-08 (empty decomposition is a normal answer), D-21 (every component reaches the draft, weak/absent matches flagged not dropped), D-13 (exactly one ack-message edit per terminal outcome), and the never-rejects guarantee (03-RESEARCH.md Pitfall 6)

## Task Commits

Both tasks followed the RED → GREEN TDD cycle and were committed atomically:

1. **Task 1: The per-message cost line and the draft writer**
   - RED: `cbb7854` (test) — 8 tests for `cost-log.ts`, confirmed failing (`Cannot find module './cost-log.js'`) before the module existed
   - GREEN: `d0ab9b0` (feat) — `cost-log.ts` + `draft-store.ts` implemented, all 8 tests pass
2. **Task 2: processMeal — the single orchestrator for voice and text**
   - RED: `e0cbc02` (test) — 14 tests for `voice-pipeline.ts`, confirmed failing (`Cannot find module './voice-pipeline.js'`) before the module existed
   - GREEN: `2d152f3` (feat) — `voice-pipeline.ts` implemented, all 14 tests pass on first run

**Plan metadata:** (this commit, immediately following)

## TDD Gate Compliance

Both tasks followed the full RED → GREEN cycle:
- Task 1: `cbb7854` (test, confirmed failing via a temporary implementation removal + re-run) → `d0ab9b0` (feat, 8/8 green). No refactor needed.
- Task 2: `e0cbc02` (test, confirmed failing the same way) → `2d152f3` (feat, 14/14 green on first run). No refactor needed.

## Files Created/Modified

- `src/application/cost-log.ts` — `buildCostLine`, `logCost`, `CostInputs`, `narrowTokenUsage` (defensive AI SDK v7 `LanguageModelUsage` narrowing)
- `src/application/cost-log.test.ts` — 8 tests covering every behaviour bullet
- `src/application/draft-store.ts` — `saveDraft(db, row): Promise<number>`
- `src/application/voice-pipeline.ts` — `processMeal`, `PipelineDeps`, `ProcessMealArgs`, `ProcessMealInput`, the `finish()` terminal-failure helper
- `src/application/voice-pipeline.test.ts` — 14 tests covering every behaviour bullet with hand-built fakes for all six ports

## Decisions Made

- Followed the orchestrator's explicit correction to plan 03-04's `DishDecomposer` port shape (`decompose(): Promise<DecompositionResult>`, already applied on this worktree's base commit `2327abd`) rather than the 03-06-PLAN.md text's literal `Promise<Decomposition>` reference — read `src/adapters/llm/types.ts` directly to confirm before writing any code, per the correction's instruction
- Narrowed `LanguageModelUsage` off the installed `ai@7.0.62` package's actual type declarations (`node_modules/ai/dist/index.d.ts`) rather than guessing field names — confirmed `inputTokens`/`outputTokens` (both `number | undefined`) is the real v7 shape before writing `narrowTokenUsage`
- Reworded one doc comment in `voice-pipeline.ts` away from the literal string "cosineDistance" (kept the same meaning — "vector-distance ordering") after it tripped the plan's own acceptance-criteria grep gate (`grep -n "cosineDistance\|drizzle-orm/pg-core"` must return no results) — same category of fix as 03-01-SUMMARY.md's precedent for `verify-stt.ts`

## Deviations from Plan

None beyond the doc-comment reword above (a grep-gate-compliance fix, not a scope or behavior change) and consuming the orchestrator's already-applied port-widening correction (not something this plan itself needed to decide).

## Issues Encountered

- This worktree had no `node_modules` (isolated worktree, gitignored, matching 03-04's precedent). Ran `npm install` before starting Task 1; `package-lock.json` picked up the same cosmetic caret-to-exact-pin re-normalization noted in 03-04-SUMMARY.md — left uncommitted/unstaged in every task commit since it is not a task deliverable.

## User Setup Required

None — no external service configuration required. No new environment variable added.

## Known Stubs

None. Both new application-layer modules and the orchestrator are complete, fully tested (22 new tests total), and exported for plans 07-08 to import. `processMeal` has no unwired branch — every documented outcome (success, no-food, STT failure, decomposition failure, internal error) has a concrete, tested implementation.

## Threat Flags

None beyond what the plan's own `<threat_model>` already tracks (T-03-29 through T-03-36) — no new network endpoints, auth paths, or trust-boundary surface introduced beyond what this plan's threat register already scoped.

## Verification

- `npx vitest run src/application/` — 4 test files, 39 tests, all passing (cost-log, idempotency, limits, voice-pipeline)
- `npm run typecheck` — exits 0
- `npm test` — full suite, 34 test files, 449 tests, all passing
- `grep -rln "from 'grammy'" src/application/` — no results
- `grep -n "cosineDistance\|drizzle-orm/pg-core" src/application/voice-pipeline.ts` — no results

## Next Phase Readiness

- `processMeal`, `PipelineDeps`, `ProcessMealArgs` are ready for plan 03-07 to wire into the actual grammY voice/text message handlers (constructing the real adapters and a grammY-backed `MessageEditor`) and for plan 03-08's startup sweep
- `saveDraft` and `buildCostLine`/`logCost` are independently tested and ready to be called from the same wiring
- No blockers identified

---
*Phase: 03-voice-pipeline*
*Completed: 2026-08-12*

## Self-Check: PASSED

- FOUND: src/application/cost-log.ts
- FOUND: src/application/cost-log.test.ts
- FOUND: src/application/draft-store.ts
- FOUND: src/application/voice-pipeline.ts
- FOUND: src/application/voice-pipeline.test.ts
- FOUND commit cbb7854
- FOUND commit d0ab9b0
- FOUND commit e0cbc02
- FOUND commit 2d152f3
