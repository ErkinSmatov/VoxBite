---
phase: 03-voice-pipeline
plan: 08
subsystem: bot
tags: [grammy, composition-root, spend-control, wiring, tdd-partial]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: "src/adapters/stt (plan 01), src/adapters/llm (plan 04), src/adapters/embeddings + src/adapters/fdc-repository (Phase 1), src/application/types+pipeline-copy (plan 03), src/application/voice-pipeline.ts processMeal/PipelineDeps (plan 06), src/application/idempotency.ts findInterruptedUpdates/markInterrupted (plan 05), src/bot/telegram/message-editor.ts + src/bot/handlers/meal.ts (plan 07)"
provides:
  - "src/bot/pipeline-wiring.ts: resolveSttModel()/buildMealHandlerDeps() — the composition-root helper that constructs the real adapters once"
  - "src/bot/startup-sweep.ts: runStartupSweep() — the D-11 interrupted-run notice, no resume path"
  - "src/bot/bot.ts: voice/text/unsupported handlers registered behind the allowlist gate, order-asserted by bot.wiring.test.ts"
  - "src/config/env.ts: one new optional key, STT_MODEL"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pipeline-wiring.ts's MealWiringFactories seam mirrors the client?/generate? injectable pattern already used by createOpenAIEmbedder/createOpenAITranscriber/createOpenAIDecomposer — buildMealHandlerDeps is fully unit-testable with zero network access and no OPENAI_API_KEY/DATABASE_URL"
    - "startup-sweep.ts takes notify as an injected (chatId, text) => Promise<unknown> function, structurally typed like message-editor.ts's EditableApi, rather than a grammY Api or Bot"

key-files:
  created:
    - src/bot/pipeline-wiring.ts
    - src/bot/pipeline-wiring.test.ts
    - src/bot/startup-sweep.ts
    - src/bot/startup-sweep.test.ts
  modified:
    - src/config/env.ts
    - src/config/env.test.ts
    - .env.example
    - src/bot/bot.ts
    - src/bot/bot.wiring.test.ts
    - src/bot/index.ts

key-decisions:
  - "resolveSttModel's fallback direction is asymmetric by design (T-03-48): an empty or unrecognised STT_MODEL override can only ever resolve to the cheaper adapters/stt/types.ts STT_MODEL constant, never to an arbitrary or more expensive model — the allowlist is built from the two imported constants, never a string literal"
  - "buildMealHandlerDeps constructs every adapter (transcriber, decomposer, embedder, repo, editor) exactly once per createBot() call, at startup, not per update — matches 03-06/07's 'never build an OpenAI client per message' precedent"
  - "startup sweep's notify/db seam plus try/catch at every stage (findInterruptedUpdates, each notify, markInterrupted, and one outer catch) means runStartupSweep structurally cannot reject — there is no code path that reaches an unguarded await"
  - "DAILY_MESSAGE_CAP, MAX_VOICE_SECONDS and DECOMPOSITION_MODEL deliberately did NOT become env keys — recorded inline in .env.example's STT_MODEL comment block so the reasoning travels with the file, not just this summary"

patterns-established:
  - "Composition-root helper (pipeline-wiring.ts) stays a separate file from bot.ts specifically so bot.ts's existing rule ('never call loadEnv() or build infrastructure') is not violated by Phase 3's real-adapter wiring"

requirements-completed: [VOICE-01, VOICE-02, VOICE-04]

duration: 55min
completed: 2026-08-13
---

# Phase 3 Plan 08: Wire the Phase Together — Composition Root, Allowlist-Order Proof, Startup Sweep Summary

**The composition root that turns Phase 3's seven behind-a-port plans into a running bot: one optional `STT_MODEL` env override, `buildMealHandlerDeps()` constructing every real adapter exactly once, voice/text/unsupported handlers registered and now provably ordered after the allowlist gate, and the D-11 startup sweep that apologises to (never resumes) anyone whose analysis died mid-run.**

## Performance

- **Duration:** ~55 min (including `npm install` for this worktree's isolated `node_modules`)
- **Tasks:** 4 of 4 completed. Tasks 1-3 (`type="auto"`) were executed by the executor; Task 4 was a blocking `checkpoint:human-verify` — the owner ran `npm run bot` and the nine-step real-Telegram smoke check and approved the result to the orchestrator.
- **Files created:** 4
- **Files modified:** 6

## Accomplishments

- **Task 1** — `src/config/env.ts` gains exactly one new optional key, `STT_MODEL` (never `REQUIRED_ENV_KEYS`, carries only the raw string — validation/fallback live in `pipeline-wiring.ts`). `.env.example` documents it with a full first-time-owner walkthrough in Russian, and explicitly records why `DAILY_MESSAGE_CAP`/`MAX_VOICE_SECONDS`/`DECOMPOSITION_MODEL` stay code constants instead of becoming env keys. `env.test.ts` updated (`OPTIONAL_ENV_KEYS` assertion + new default-empty case).
- **Task 2** — `src/bot/pipeline-wiring.ts`: `resolveSttModel()` (allowlists exactly `STT_MODEL`/`STT_COMPARISON_MODEL` from `adapters/stt/types.ts`, warns once in Russian and falls back to the cheap model on anything else — T-03-48) and `buildMealHandlerDeps()` (constructs `createOpenAITranscriber`/`createOpenAIDecomposer`/`createOpenAIEmbedder`/`createDrizzleFdcRepository`/`createMessageEditor` exactly once via an injectable `factories?` seam, mirroring the existing `client?`/`generate?` pattern). `src/bot/bot.ts` now builds `mealDeps` in section 5 and registers `message:voice`, `message:text`, and one array-form registration covering `message:audio`/`video_note`/`photo`/`document`/`sticker`/`video`, all placed after the existing command/callbackQuery registrations. `bot.wiring.test.ts` gained the general source-index assertion (T-03-46, closes T-03-44): every `bot.on`/`bot.command`/`bot.callbackQuery` call site must sit after the actual `bot.use(createAllowlistMiddleware(...))` call — verified by hand (moved the line, confirmed both the new test and the pre-existing D-05 order test fail, then restored the file).
- **Task 3** — `src/bot/startup-sweep.ts`: `runStartupSweep()` reads every `processed_updates` row still `processing`, notifies each affected chat with `pipelineCopy.interruptedByRestart` (one failed notify never blocks the rest), marks ALL found rows `interrupted` regardless of notify outcome, and never rejects (a DB failure at any stage logs one Russian line and yields a zeroed report). No resume path — the file imports neither `processMeal`, `downloadVoice` nor any transcription function, enforced by a source-grep test. `src/bot/index.ts` awaits the sweep before `bot.start()` and passes `sttModel: env.STT_MODEL` into `createBot`; no webhook, no HTTP server (D-09) — grep-verified.

## Task Commits

1. **Task 1: One optional STT model override in env.ts and .env.example** — `1ff05d5` (feat)
2. **Task 2: Construct the adapters once and register the handlers behind the allowlist** — `ac83a6b` (feat)
3. **Task 3: The D-11 startup sweep for runs interrupted by a restart** — `ddc1e8e` (feat)

None of the three tasks were marked `tdd="true"` in the plan (all `type="auto"`), so there is no RED/GREEN gate to report — each commit carries both the new test file(s) and the implementation together, verified green before committing.

## Files Created/Modified

- `src/config/env.ts` — `STT_MODEL` added to `OPTIONAL_ENV_KEYS` and `AppEnv`
- `src/config/env.test.ts` — `OPTIONAL_ENV_KEYS` assertion updated, one new default-empty case for `STT_MODEL`
- `.env.example` — new `STT_MODEL=` block with full Russian owner instructions and the "why not an env key" note for the three constants that stay code-only
- `src/bot/pipeline-wiring.ts` — `resolveSttModel`, `buildMealHandlerDeps`, `MealWiringDeps`, `MealWiringFactories`
- `src/bot/pipeline-wiring.test.ts` — 8 tests covering every behaviour bullet, zero network calls, zero required env vars
- `src/bot/bot.ts` — `BotDeps.sttModel`, meal-handler construction and registration in section 5, updated module doc comment
- `src/bot/bot.wiring.test.ts` — new `describe` block (4 tests) for the Phase 3 registrations, plus a fix to the pre-existing D-05 order test (see Deviations)
- `src/bot/startup-sweep.ts` — `runStartupSweep`, `StartupSweepDeps`, `SweepReport`
- `src/bot/startup-sweep.test.ts` — 7 tests covering every behaviour bullet including partial-notify-failure and both rejection cases
- `src/bot/index.ts` — `runStartupSweep` awaited before `bot.start()`, `sttModel: env.STT_MODEL` passed to `createBot`

## Decisions Made

- Followed the plan's `<interfaces>` block literally for `DishDecomposer.decompose(): Promise<DecompositionResult>` — confirmed this is the shape already live in `src/adapters/llm/types.ts` on this worktree's base commit (the orchestrator's correction referenced by 03-06-SUMMARY.md had already landed), so `voice-pipeline.ts`'s `PipelineDeps` needed no further changes for this plan.
- Kept `pipeline-wiring.ts`'s factories seam typed as `Partial<MealWiringFactories>` (each factory individually overridable) rather than requiring the test to supply all five — matches the plan's "the unit test injects fakes; production passes nothing" framing while keeping the type strict (`typeof createOpenAITranscriber` etc., not `unknown`).

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed a pre-existing D-05 order test that could never fail**

- **Found during:** Task 2, while writing the new general source-index assertion for T-03-46.
- **Issue:** `bot.wiring.test.ts`'s existing "registers allowlist -> session -> conversations" test computed `source.indexOf('createAllowlistMiddleware')`, which matches the `import { createAllowlistMiddleware } from ...` line near the top of the file — a position that is always earlier than every registration regardless of where the actual `bot.use(createAllowlistMiddleware(...))` call sits. The assertion could therefore never fail, even if the allowlist middleware were moved to the very end of `createBot()`. My first draft of the new T-03-46 assertion had the identical bug (proven by hand: moving the line still left both tests green).
- **Fix:** Both the existing test and the new test now search for the literal call-site substring `'bot.use(createAllowlistMiddleware('` instead of the bare identifier. Re-verified by hand: moved the `bot.use(createAllowlistMiddleware(...))` line to the end of `createBot()`, confirmed BOTH tests fail with the expected assertion errors, then restored the file (byte-identical, diffed against a pre-edit copy).
- **Files modified:** `src/bot/bot.wiring.test.ts`
- **Commit:** `ac83a6b`

## Issues Encountered

- This worktree had no `node_modules` (isolated worktree, gitignored, matching every prior plan in this phase). Ran `npm install` before starting Task 1; `package-lock.json` picked up the same cosmetic re-normalization noted in every prior plan's summary — reverted with `git checkout -- package-lock.json` before finishing, never staged in any task commit.
- This worktree's branch initially pointed at an unrelated Phase 1 planning history (`51b50a4`, not descended from the orchestrator's `5fc8cbb` merge commit that carries plans 01-07). Per the branch-check protocol, ran `git reset --hard 5fc8cbb...` before starting any work so this plan builds directly on plans 01-07 as intended. The working tree was already clean (no partial work from a prior terminated attempt to salvage).

## User Setup Required

**Task 4 (checkpoint) — DONE. The owner performed and approved:**
1. Run `npm run check-setup` from the project root and confirm the last line is `SETUP OK`.
2. Run `npm run bot` and confirm the startup log lines described below.
3. Send a real voice message, a real text message, an unsupported message type (photo/video note), and interrupt-and-restart the bot, following the nine numbered steps in `03-08-PLAN.md`'s Task 4 `<how-to-verify>` block.

This step cost real money (roughly a few cents total, per the plan) and used the live Telegram bot token and OpenAI API key already configured in `.env` from Phase 1/2. It was the first time this phase's code made a real paid call. The owner reported all nine steps behaved as specified and replied "approved" — recorded by the orchestrator, which did not itself run the bot or spend the owner's API budget.

## Known Stubs

None. All three completed tasks (env key, adapter construction + handler registration, startup sweep) are fully wired with no unwired branch — every documented outcome has a concrete, tested implementation. Task 4 (manual end-to-end verification) is deferred to the owner, as designed — the code it exercises is complete and unit-tested, only the real-Telegram/real-OpenAI path itself is unverified until the owner runs it.

## Threat Flags

None beyond what the plan's own `<threat_model>` already tracks (T-03-46 through T-03-54) — this plan closes each of those threats exactly as scoped:
- T-03-46 (handler registered ahead of the allowlist gate) — closed by the corrected general source-index assertion.
- T-03-47 (env key weakening a spend guard) — no such key created; `.env.example` grep-gated to confirm.
- T-03-48 (STT_MODEL selecting an arbitrary/expensive model) — `resolveSttModel`'s allowlist-of-two.
- T-03-49 (sweep logging PII) — all log lines carry counts only, verified by a dedicated test.
- T-03-50 (sweep crashing `npm run bot`) — `runStartupSweep` never rejects, verified by the DB-rejects test.
- T-03-51 (sweep messaging an arbitrary chat id) — inherited from `claimUpdate`'s allowlist-gated write path (plan 05), unchanged here.
- T-03-52 (repudiation — a row swept forever) — `markInterrupted` applied to ALL found ids regardless of notify outcome.
- T-03-53 (token leak via sweep's grammY calls) — the sweep's own catch blocks never pass a caught error object to `console.error`, only fixed strings.
- T-03-54 (no inbound HTTP surface) — accepted per D-09, unchanged; `index.ts` still contains no `setWebhook`/`webhookCallback`/`express`/`createServer`.

No new network endpoints, auth paths, or trust-boundary surface introduced beyond what this plan's threat register already scoped.

## Verification

- `npx vitest run src/config/env.test.ts src/bot/pipeline-wiring.test.ts src/bot/bot.wiring.test.ts src/bot/startup-sweep.test.ts` — 4 test files, 40 tests, all passing
- `npm test` (full suite) — 38 test files, 490 tests, all passing
- `npm run typecheck` — exits 0
- `grep -c '^STT_MODEL=$' .env.example` — 1
- `grep -c "^DAILY_MESSAGE_CAP=\|^MAX_VOICE_SECONDS=\|^DECOMPOSITION_MODEL=" .env.example` — 0
- `grep -c "gpt-4o" src/bot/pipeline-wiring.ts` — 0
- `grep -v '^\s*[*/]' src/bot/startup-sweep.ts | grep -c "processMeal\|downloadVoice\|transcribe"` — 0
- `grep -c "console.log(row\|chatId}\|telegramId}" src/bot/startup-sweep.ts` — 0
- `grep -c "setWebhook\|webhookCallback\|express\|createServer" src/bot/index.ts` — 0
- Hand-verified (per acceptance criteria): moving `bot.use(createAllowlistMiddleware(...))` to the end of `createBot()` makes both the general T-03-46 assertion and the pre-existing D-05 order test fail; file restored byte-identical afterward

## Next Phase Readiness

- All four tasks are complete. Tasks 1-3 are committed and green; Task 4, the owner's real end-to-end Telegram smoke check, was performed by the owner and approved.
- No blockers. The live chain — voice and text in, ack edited in place into a result card, unsupported types refused for free, interrupted runs swept on restart — is confirmed working against real Telegram and real OpenAI.

---
*Phase: 03-voice-pipeline*
*Completed: 2026-08-13 (Tasks 1-3); Task 4 verified and approved by the owner 2026-08-14*

## Self-Check: PASSED

- FOUND: src/bot/pipeline-wiring.ts
- FOUND: src/bot/pipeline-wiring.test.ts
- FOUND: src/bot/startup-sweep.ts
- FOUND: src/bot/startup-sweep.test.ts
- FOUND commit 1ff05d5
- FOUND commit ac83a6b
- FOUND commit ddc1e8e
