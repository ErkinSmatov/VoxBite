---
phase: 03-voice-pipeline
verified: 2026-08-14T00:00:00Z
status: human_needed
score: 4.5/5 must-haves verified (roadmap success criteria)
overrides_applied: 0
human_verification:
  - test: "Run the ~10-sample STT accuracy spot-check with npm run verify-stt"
    expected: "Owner drops ~10 real voice recordings into samples/voice/, runs `npm run verify-stt`, and eyeballs both gpt-4o-mini-transcribe and gpt-4o-transcribe transcripts side by side for reasonable RU/KZ accuracy, then records which model is kept (or confirms the current STT_MODEL default) as an explicit decision."
    why_human: "This is a subjective accuracy judgment over real audio the owner must supply — no test or grep can score transcription quality. The tooling (scripts/verify-stt.ts, npm run verify-stt) exists and is unit-testable/wired, but the systematic 10-sample run has not been executed yet. The Task 4 live smoke check (03-08) exercised real STT on a handful of ad hoc voice messages and the owner approved that the pipeline works end to end, which is good evidence the STT path is functional, but it is not the same as the roadmap's specific ~10-sample accuracy spot-check."
---

# Phase 3: Voice pipeline Verification Report

**Phase Goal:** A voice or text message describing a meal is transcribed, decomposed into components with gram estimates, and each component is matched against FDC candidates — wired end to end with immediate ack and idempotent processing.
**Verified:** 2026-08-14
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can send a voice message and immediately receives an ack while processing continues in background | ✓ VERIFIED | `src/bot/handlers/meal.ts` `createVoiceHandler`: claim → onboarding check → daily cap → download → `ctx.reply(pipelineCopy.ack)` → `void processMeal(...)` fired without `await`. Owner-approved live smoke check (03-08-SUMMARY.md Task 4, step 2) confirms `Секунду, разбираю 🎧` arrives before analysis finishes. |
| 2 | Voice message transcribed via STT (RU/KZ) with reasonable accuracy on a ~10-sample manual spot-check | ? UNCERTAIN (see human_verification) | `scripts/verify-stt.ts` + `npm run verify-stt` exist, are wired to `createOpenAITranscriber`, and compare `STT_MODEL`/`STT_COMPARISON_MODEL` side by side (verified by reading the script and `package.json`'s `verify-stt` script entry). However, `samples/voice/` (gitignored, owner-populated) does not exist in this checkout, and no artifact records the owner having run and judged the 10-sample comparison. The 03-08 live smoke check exercised real STT on a few ad hoc voice messages and the owner approved the pipeline overall, which is real but partial evidence — not the systematic accuracy spot-check the criterion specifies. |
| 3 | Transcribed/typed text decomposed into components with English names + gram estimates; single-ingredient dish yields exactly one component | ✓ VERIFIED | `src/adapters/llm/types.ts` `ComponentSchema` requires both `component` (RU) and `component_en` (EN) from the same `generateObject` call (DECOMP-01, no separate translation step). `src/adapters/llm/prompt.ts` explicitly instructs single-ingredient dishes stay one component and composite Central Asian dishes (бешбармак, куырдак, плов, манты) get decomposed into FDC-findable ingredients (DECOMP-02, D-01). `src/adapters/llm/prompt.test.ts` and `openai-decompose.test.ts` assert this behavior. Live smoke check step 4 confirmed "один банан" → exactly one component. |
| 4 | LLM output schema-validated (structured output + Zod); invalid/empty result triggers one retry, second failure → user-facing "couldn't parse" message | ✓ VERIFIED | `src/adapters/llm/openai-decompose.ts`: `generateObject` with `DecompositionSchema` (Zod); catch block checks `NoObjectGeneratedError.isInstance`, retries once with `buildDecompositionPrompt(transcript, strict=true)`, and on a second failure throws `DecompositionFailedError`, caught in `voice-pipeline.ts` and mapped to `pipelineCopy.decompositionFailed` ("Не смог разобрать сообщение на ингредиенты..."). A well-formed empty `items: []` is explicitly excluded from the retry path (D-08) and confirmed by `openai-decompose.test.ts`. |
| 5 | Typed text flows through the identical STT-output → decomposition → matching pipeline; duplicate/retried Telegram updates do not produce duplicate processing | ✓ VERIFIED | `src/application/voice-pipeline.ts` `processMeal()` branches only at step 1 (obtaining the transcript) — voice and text converge into the same decompose → embed → match → persist → render path (VOICE-04). `src/application/idempotency.ts` `claimUpdate()` inserts into `processed_updates` with `onConflictDoNothing()` keyed on Telegram's `update_id` PRIMARY KEY (D-10) — confirmed by `idempotency.test.ts` and by `processed-updates.ts`'s schema (`updateId` as `.primaryKey()`). Both voice and text handlers call `claimUpdate` as their first effectful statement before any paid call. Live smoke check step 8 confirmed the restart/interrupted-update path (D-11) behaves correctly. |

**Score:** 4/5 fully verified, 1/5 uncertain pending owner-run spot-check (roadmap criterion 2)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/adapters/stt/types.ts` | `Transcriber` port + `STT_MODEL` constant | ✓ VERIFIED | `export interface Transcriber`, `STT_MODEL = 'gpt-4o-mini-transcribe'`, `STT_COMPARISON_MODEL`, `MAX_VOICE_SECONDS` all present |
| `src/adapters/stt/openai-transcribe.ts` | OpenAI adapter, injectable client, retry/backoff | ✓ VERIFIED | `createOpenAITranscriber`, retry w/ backoff on 429/5xx, terminal on 401/insufficient_quota, no disk writes, no logged audio/transcript |
| `scripts/verify-stt.ts` | D-04 owner-facing verification script | ✓ VERIFIED | Reads `samples/voice/` (gitignored), transcribes with both models, prints cost estimate, no Telegram/DB imports |
| `src/db/schema/processed-updates.ts` | idempotency ledger table | ✓ VERIFIED | `update_id` PK, `status` check constraint, `(telegram_id, created_at)` index |
| `src/db/schema/diary-drafts.ts` | persisted draft table | ✓ VERIFIED | unique `update_id`, `user_id` FK cascade, `messageId`, `components` jsonb |
| `drizzle/0006_voice_pipeline_rls.sql` | RLS on both new tables | ✓ VERIFIED | `ENABLE ROW LEVEL SECURITY` for both tables + anon/authenticated revoke guard, applied per 03-02-SUMMARY.md Task 3 checkpoint |
| `src/application/types.ts` | `MealDraft`/`DraftComponent`/`MessageEditor`/threshold | ✓ VERIFIED | `WEAK_MATCH_SIMILARITY_THRESHOLD = 0.7`, `isWeakMatch()` |
| `src/bot/formatting/pipeline-copy.ts` | every Russian string, zero grammY imports | ✓ VERIFIED | `ack`, `noFood`, `sttFailed`, `decompositionFailed`, `internalError`, `tooLong`, `dailyCapReached`, `unsupportedMessage`, `interruptedByRestart`, `notOnboarded` — no grammY import present |
| `src/bot/formatting/result-card.ts` | D-18 read-only card | ✓ VERIFIED | `buildResultCard`, weak-match marker "совпадение слабое, проверь"; no KБЖУ numbers, no inline keyboard |
| `src/adapters/llm/types.ts` | `DishDecomposer` port + schema | ✓ VERIFIED | `DecompositionSchema`, `DECOMPOSITION_MODEL`, `DecompositionFailedError`, `DecompositionResult { decomposition, usage, model }` — matches the orchestrator's widened signature noted for plan 03-04 |
| `src/adapters/llm/prompt.ts` | decomposition prompt, testable | ✓ VERIFIED | `buildDecompositionPrompt`, composite-dish rule with concrete examples |
| `src/adapters/llm/openai-decompose.ts` | generateObject + single retry | ✓ VERIFIED | `NoObjectGeneratedError` handling, exactly one retry |
| `src/application/idempotency.ts` | claim/mark/find/markInterrupted | ✓ VERIFIED | `onConflictDoNothing`, `findInterruptedUpdates`, `markInterrupted` |
| `src/application/limits.ts` | daily cap + onboarding lookup | ✓ VERIFIED | `DAILY_MESSAGE_CAP`, `countRecentUpdates`, `findOnboardedUser` |
| `src/application/voice-pipeline.ts` | `processMeal()` orchestrator | ✓ VERIFIED | Single function, branches only at transcript acquisition, batched embed call, never rejects (defensive outer catch) |
| `src/application/draft-store.ts` | `saveDraft()` | ✓ VERIFIED | writes to `diaryDrafts` |
| `src/application/cost-log.ts` | `buildCostLine`/`logCost` | ✓ VERIFIED | one line per message, no transcript text |
| `src/bot/telegram/download-voice.ts` | in-memory download, pre-download duration cap | ✓ VERIFIED | `VoiceTooLongError` thrown before `getFile()`; buffer never written to disk; token never logged |
| `src/bot/telegram/message-editor.ts` | `MessageEditor` grammY impl | ✓ VERIFIED | `editMessageText` present |
| `src/bot/handlers/meal.ts` | `createVoiceHandler`/`createTextHandler`/`createUnsupportedHandler` | ✓ VERIFIED | gate order matches plan exactly: claim → onboarding → daily cap → download/bound → ack → detached `processMeal` |
| `src/bot/pipeline-wiring.ts` | `buildMealHandlerDeps()` | ✓ VERIFIED | constructs real adapters once |
| `src/bot/startup-sweep.ts` | `runStartupSweep()` | ✓ VERIFIED | `findInterruptedUpdates`, no `processMeal`/`downloadVoice` import (no resume path), never rejects |
| `src/bot/bot.wiring.test.ts` | source-order assertion | ✓ VERIFIED | asserts every `bot.on/command/callbackQuery` call index > `bot.use(createAllowlistMiddleware(` call-site index |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `scripts/verify-stt.ts` | `openai-transcribe.ts` | `createOpenAITranscriber({ model })` | ✓ WIRED | imported and called for both models |
| `package.json` | `scripts/verify-stt.ts` | npm script | ✓ WIRED | `"verify-stt": "tsx scripts/verify-stt.ts"` |
| `src/db/schema/index.ts` | `processed-updates.ts`/`diary-drafts.ts` | barrel re-export | ✓ WIRED | both re-exported |
| `diary-drafts.ts` | `users.ts` | FK cascade | ✓ WIRED | `references(() => users.id, { onDelete: 'cascade' })` |
| `result-card.ts` | `application/types.ts` | imports `MealDraft`, threshold | ✓ WIRED | confirmed |
| `openai-decompose.ts` | `ai` (Vercel AI SDK) | `generateObject` + Zod schema | ✓ WIRED | confirmed |
| `openai-decompose.ts` | `prompt.ts` | `buildDecompositionPrompt(transcript, strict)` | ✓ WIRED | confirmed |
| `idempotency.ts` | `processed-updates.ts` | Drizzle insert w/ `onConflictDoNothing().returning()` | ✓ WIRED | confirmed in `claimUpdate` |
| `limits.ts` | `users.ts` | select by `telegramId` where `onboardedAt` not null | ✓ WIRED | confirmed |
| `voice-pipeline.ts` | `domain/fdc-matching` | `matchIngredient` per component | ✓ WIRED | confirmed, one batched embed + parallel match |
| `voice-pipeline.ts` | `embeddings/openai-embed.ts` | `Embedder.embed(...)` one batched call | ✓ WIRED | confirmed |
| `voice-pipeline.ts` | `draft-store.ts` | `saveDraft` after matching | ✓ WIRED | confirmed |
| `bot/handlers/meal.ts` | `voice-pipeline.ts` | detached `processMeal` call w/ local `.catch` | ✓ WIRED | confirmed, not awaited |
| `bot/handlers/meal.ts` | `idempotency.ts` | `claimUpdate` before any paid call | ✓ WIRED | confirmed, first effectful statement |
| `download-voice.ts` | Telegram file API | `ctx.getFile()` then fetch | ✓ WIRED | confirmed, duration check precedes `getFile()` |
| `bot/bot.ts` | `handlers/meal.ts` | handlers registered after allowlist | ✓ WIRED | confirmed by source and by `bot.wiring.test.ts` |
| `bot/bot.ts` | `pipeline-wiring.ts` | `buildMealHandlerDeps(deps)` once | ✓ WIRED | confirmed, single construction in `createBot()` |
| `bot/index.ts` | `startup-sweep.ts` | awaited `runStartupSweep` before `bot.start()` | ✓ WIRED | confirmed |

### Behavioral Spot-Checks / Automated Verification

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase test suite | `npx vitest run src/adapters/stt src/adapters/llm src/application src/bot` | 26 files, 317 tests passed | ✓ PASS |
| Type check | `npx tsc --noEmit` | no output, exit 0 | ✓ PASS |
| No stray debt markers in phase-modified files | `grep -n "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across all `files_modified` from 03-0*-PLAN.md | no matches | ✓ PASS |

### Owner-Run Live Smoke Check (03-08 Task 4, checkpoint)

Per 03-08-SUMMARY.md, the owner ran `npm run bot` against the live Telegram bot and OpenAI API, executed the 9-step checklist in 03-08-PLAN.md, and replied "approved". This independently corroborates: instant ack (criterion 1), card-replaces-ack with no duplicate message and no КБЖУ numbers, single-ingredient dish stays one component (criterion 3), typed text follows the same path (criterion 5), no-food message gets the friendly reply (criterion 4 partial), unsupported content types cost nothing, and the interrupted-restart notice + no double-processing after restart (criterion 5 idempotency, D-11). It does **not** independently establish the systematic ~10-sample STT accuracy spot-check (criterion 2).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| VOICE-01 | 03-07, 03-08 | send voice message | ✓ SATISFIED | `createVoiceHandler`, registered in `bot.ts`, live smoke check step 2 |
| VOICE-02 | 03-03, 03-07, 03-08 | instant ack | ✓ SATISFIED | `pipelineCopy.ack`, fired-without-await pattern, live smoke check step 2 |
| VOICE-03 | 03-01, 03-06 | STT RU/KZ | ✓ SATISFIED (tooling); ? spot-check pending | `createOpenAITranscriber`, `verify-stt.ts` built and wired; systematic 10-sample accuracy judgment not yet run by owner |
| VOICE-04 | 03-02, 03-03, 03-05, 03-06, 03-07, 03-08 | text follows same pipeline | ✓ SATISFIED | `processMeal` single branch point, `createTextHandler` |
| DECOMP-01 | 03-03, 03-04, 03-06 | RU/EN name + grams, same call | ✓ SATISFIED | `ComponentSchema` |
| DECOMP-02 | 03-04, 03-06 | single-ingredient stays single | ✓ SATISFIED | prompt + tests + live smoke check step 4 |
| DECOMP-03 | 03-04, 03-06 | schema validation + one retry + user message | ✓ SATISFIED | `NoObjectGeneratedError` retry-once logic, `pipelineCopy.decompositionFailed` |

No orphaned requirements — all 7 IDs mapped in REQUIREMENTS.md (Phase 3) appear in at least one plan's `requirements` frontmatter and have corresponding code evidence above.

### Anti-Patterns Found

None. Scanned every file listed in `files_modified` across all eight 03-0*-PLAN.md frontmatter blocks for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches.

### Human Verification Required

### 1. Systematic ~10-sample STT accuracy spot-check (roadmap success criterion 2)

**Test:** Record (or gather) ~10 real voice messages covering a mix of Russian and Kazakh/mixed dish names, drop them into the gitignored `samples/voice/` folder, and run `npm run verify-stt`.
**Expected:** The script prints, for each sample, the transcript from both `gpt-4o-mini-transcribe` (current `STT_MODEL`) and `gpt-4o-transcribe` side by side plus an estimated cost. The owner judges whether `gpt-4o-mini-transcribe`'s accuracy is "reasonable" for RU/KZ dish names (per D-03's cost-vs-accuracy tradeoff) and either keeps `STT_MODEL` as-is or changes the one constant in `src/adapters/stt/types.ts`.
**Why human:** Transcription accuracy on real recordings is a subjective judgment call that requires the owner's own voice/audio input — this cannot be scored by grep or an automated test. The tooling to run this check already exists and is fully wired (verified above); only the owner's execution and judgment step remains.

### Gaps Summary

No code-level gaps. All artifacts, key links, and unit/type-level behaviors for all 5 roadmap success criteria are implemented, wired, and covered by 317 passing tests plus an owner-approved live end-to-end Telegram smoke check. The single open item is procedural, not architectural: the owner has not yet run the systematic ~10-real-sample STT accuracy spot-check that roadmap success criterion 2 specifically calls for (distinct from the ad hoc real-STT calls already exercised during the Task 4 smoke check). This routes the phase to `human_needed` rather than `passed` — the phase should not be marked fully done until the owner runs `npm run verify-stt` against ~10 real samples and confirms (or overrides) the `STT_MODEL` choice.

---

_Verified: 2026-08-14_
_Verifier: Claude (gsd-verifier)_
