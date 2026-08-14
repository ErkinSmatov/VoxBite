---
phase: 03-voice-pipeline
reviewed: 2026-08-14T12:23:28Z
depth: standard
files_reviewed: 43
files_reviewed_list:
  - drizzle/0005_unique_pyro.sql
  - drizzle/0006_voice_pipeline_rls.sql
  - drizzle/meta/_journal.json
  - scripts/verify-stt.ts
  - src/adapters/llm/openai-decompose.test.ts
  - src/adapters/llm/openai-decompose.ts
  - src/adapters/llm/prompt.test.ts
  - src/adapters/llm/prompt.ts
  - src/adapters/llm/types.ts
  - src/adapters/stt/openai-transcribe.test.ts
  - src/adapters/stt/openai-transcribe.ts
  - src/adapters/stt/types.ts
  - src/application/cost-log.test.ts
  - src/application/cost-log.ts
  - src/application/draft-store.ts
  - src/application/idempotency.test.ts
  - src/application/idempotency.ts
  - src/application/limits.test.ts
  - src/application/limits.ts
  - src/application/types.ts
  - src/application/voice-pipeline.test.ts
  - src/application/voice-pipeline.ts
  - src/bot/bot.ts
  - src/bot/bot.wiring.test.ts
  - src/bot/formatting/pipeline-copy.ts
  - src/bot/formatting/result-card.test.ts
  - src/bot/formatting/result-card.ts
  - src/bot/handlers/meal.test.ts
  - src/bot/handlers/meal.ts
  - src/bot/index.ts
  - src/bot/pipeline-wiring.test.ts
  - src/bot/pipeline-wiring.ts
  - src/bot/startup-sweep.test.ts
  - src/bot/startup-sweep.ts
  - src/bot/telegram/download-voice.test.ts
  - src/bot/telegram/download-voice.ts
  - src/bot/telegram/message-editor.ts
  - src/config/env.test.ts
  - src/config/env.ts
  - src/db/schema/diary-drafts.ts
  - src/db/schema/index.ts
  - src/db/schema/processed-updates.ts
findings:
  critical: 2
  warning: 10
  info: 6
  total: 18
status: issues_found
remediation:
  applied: 2026-08-14
  by: orchestrator (/gsd-execute-phase 3)
  fixed:
    - CR-01 (blocker) — prompt no longer built with String.replace; commit 3052ca6
    - CR-02 (blocker) — byte ceiling + Content-Length + buffered-length checks + 30s fetch timeout; commit 2e40ea4
    - WR daily cap off-by-one — comparison corrected to `>`; commit 5ea8f48
    - WR no cost line on failure paths — finish() now logs accumulated cost; commit 2299444
    - WR delivered card overwritten by late failure — post-delivery steps isolated; commit 2299444
    - WR silent text truncation — now refused via pipelineCopy.textTooLong; commit 27b7bcb
    - WR source-text middleware order assertion — bot.wiring.runtime.test.ts added, import hack removed; commit 9107716
  outstanding:
    - remaining WARNING and INFO findings in this report were not addressed in this pass
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-14T12:23:28Z
**Depth:** standard
**Files Reviewed:** 43
**Status:** issues_found

## Summary

The phase's headline invariants mostly hold under adversarial reading: the allowlist gate is registered
before every `bot.on/command/callbackQuery` in `src/bot/bot.ts`; `claimUpdate` really is the first
effectful statement in both meal handlers, ahead of onboarding, the daily cap, the download and every paid
call; `processMeal` cannot reject; no transcript, audio buffer, token or download URL is logged or written
to disk; both new tables get RLS with zero policies. `tsc --noEmit` is clean and all 490 tests pass.

Two defects nonetheless break stated contracts:

1. The dish-decomposition prompt is assembled with `String.prototype.replace(string, transcript)`, so a
   user-controlled `$&`, `` $` `` or `$'` inside the transcript rewrites the prompt itself (verified by
   execution). This is a correctness bug in what 03-CONTEXT.md calls "the single biggest accuracy lever",
   and a prompt-injection primitive.
2. D-14's "free" 60-second cap trusts `message.voice.duration`, which is a client-supplied field on
   `sendVoice`, and there is no byte-size cap, no download timeout and no post-download validation. The
   only bound on what gets billed to OpenAI is a number the sender chooses.

Beyond those, the biggest systemic gaps are: **no cost line is ever printed on a failure path** (money is
spent invisibly exactly when the pipeline misbehaves repeatedly), a **daily-cap off-by-one** (effective cap
is 29, not 30), **silent truncation of long text meals**, and a **success path that can overwrite a correct
result card with "что-то пошло не так" while the draft stays persisted**. The composition-root test suite
(`bot.wiring.test.ts`) asserts source-text ordering rather than runtime middleware ordering, and `bot.ts`
has been contorted (an import moved below the code, line 159) to satisfy it — that is false confidence in
the phase's central security property.

## Critical Issues

### CR-01: User-controlled `$` patterns rewrite the decomposition prompt

**File:** `src/adapters/llm/prompt.ts:47`
**Issue:** `BASE_INSTRUCTIONS.replace('{{TRANSCRIPT}}', transcript)` uses the two-argument string form of
`String.prototype.replace`, where the *replacement* string is scanned for special patterns (`$$`, `$&`,
`` $` ``, `$'`). `transcript` is fully user-controlled — the text handler passes whatever the user typed,
and STT output can contain `$`. Verified by execution:

```js
'A {{TRANSCRIPT}} B'.replace('{{TRANSCRIPT}}', "x$`y")  // => "A xA y B"   (prefix injected)
'A {{TRANSCRIPT}} B'.replace('{{TRANSCRIPT}}', "z$'w")  // => "A z Bw B"   (suffix injected)
```

Consequences: (a) the transcript actually analysed is not what the user said, so grams/ingredients — and
therefore the nutrition the product exists to compute — are silently wrong; (b) an attacker (or a curious
beta user) can splice arbitrary prompt text before/after the data block, escaping the `"""` fencing that
`prompt.test.ts:54` believes it is testing; (c) `prompt.test.ts:10` ("includes the transcript verbatim")
passes only because its fixture contains no `$`.

**Fix:** Never build the prompt through `replace` with untrusted content in the replacement position.

```ts
// prompt.ts — split once around the marker, join with the raw transcript.
const [PROMPT_HEAD, PROMPT_TAIL] = BASE_INSTRUCTIONS.split('{{TRANSCRIPT}}') as [string, string];

export function buildDecompositionPrompt(transcript: string, strict: boolean): string {
  const base = PROMPT_HEAD + transcript + PROMPT_TAIL;
  return strict ? base + STRICT_SUFFIX : base;
}
```

Add a regression test asserting `buildDecompositionPrompt("яйцо $` $' $& 5$", false)` contains that string
byte-for-byte and that the prompt length equals `BASE_INSTRUCTIONS.length - '{{TRANSCRIPT}}'.length +
transcript.length`.

### CR-02: The 60-second spend cap trusts a client-supplied number; the download has no size cap and no timeout

**File:** `src/bot/telegram/download-voice.ts:63-82`, `src/bot/handlers/meal.ts:134`
**Issue:** `voice.duration` is not measured by Telegram — it is an optional parameter of `sendVoice`
supplied by the sending client, and the Bot API passes it through. A modified client (or any user-API
script) can send a 20 MB OGG with `duration: 1`. D-14's cap then passes for free, `downloadVoice` pulls the
whole body into memory with `await response.arrayBuffer()` — no `Content-Length` check, no byte cap, no
`AbortSignal.timeout` — and the full file is handed to OpenAI, which bills by *actual* audio length. At
Telegram's 20 MB bot-download limit and ~16 kbps speech encoding that is roughly 2.5 hours of audio per
message (~$0.50 at `gpt-4o-mini-transcribe` rates), and `DAILY_MESSAGE_CAP = 30` permits ~30 of them per
user per day. The same lie also corrupts the D-17 cost line, which reports
`durationSeconds: voice?.duration ?? 0` (`meal.ts:134`) rather than anything measured — so the overspend is
invisible in the operator log too. Separately, `fetch` with no timeout can hang the handler indefinitely,
leaving the ledger row stuck in `processing` until the next restart sweep.

The beta allowlist limits *who* can do this; it does not make the guard sound, and D-14 is documented as
"the entire point of this file".

**Fix:** Keep the free duration check, then add an independent byte-size bound and a timeout, and derive the
cost-log seconds from the bytes actually downloaded rather than from the client's claim.

```ts
// download-voice.ts
export const MAX_VOICE_BYTES = 1_500_000; // ~60 s of 16 kbps Opus, with headroom
export class VoiceTooLargeError extends Error { /* ... */ }

const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`Не удалось скачать голосовое сообщение: HTTP ${response.status}`);

const declared = Number(response.headers.get('content-length') ?? NaN);
if (Number.isFinite(declared) && declared > MAX_VOICE_BYTES) throw new VoiceTooLargeError();

const buffer = Buffer.from(await response.arrayBuffer());
if (buffer.length > MAX_VOICE_BYTES) throw new VoiceTooLargeError();
return buffer;
```

Map `VoiceTooLargeError` to `pipelineCopy.tooLong` in `meal.ts`'s existing catch, and pass
`Math.min(voice.duration, MAX_VOICE_SECONDS)` (or bytes-derived seconds) into `ProcessMealInput`.

## Warnings

### WR-01: No cost line is logged on any failure path — paid spend is invisible when it matters most

**File:** `src/application/voice-pipeline.ts:122, 142-146, 222, 227`
**Issue:** `logCost` is called only on the success path (line 212) and the empty-decomposition path (line
161). Every `finish(...)` return path skips it. A decomposition failure happens *after* a paid STT call; an
embedding/DB failure happens after paid STT **and** paid LLM calls. So the one signal D-17 exists to
provide — "an anomaly is visible the same day" — goes dark exactly in the repeated-failure scenario where a
user resends the same message five times and burns five transcriptions. The cost of failures is
structurally unobservable.
**Fix:** Move the `logCost` call into a `finally`-style tail that runs on every exit, carrying whatever was
already spent:

```ts
// track spend-so-far in locals already present (sttSeconds/sttModel/llmUsage/llmModel/embeddedCount)
// and call logCost(...) from finish() as well as from the success path, e.g. by passing a
// `spend: CostInputs` argument to finish().
```

### WR-02: Daily cap is off by one — the effective limit is 29, not `DAILY_MESSAGE_CAP`

**File:** `src/bot/handlers/meal.ts:89-107`, `src/application/limits.ts:58-68`
**Issue:** `claimUpdate` inserts the current message's `processed_updates` row *before*
`isDailyCapReached` counts rows for the same `telegram_id`. The count therefore includes the message being
handled, so the check fires when the user has 29 prior messages plus this one — the 30th message is
refused, not the 31st. The unit test (`limits.test.ts:154`, "returns true when the count equals the cap")
tests the helper in isolation and cannot see the interaction.
**Fix:** Either compare with `recentCount > DAILY_MESSAGE_CAP` at the call site, or subtract the current
claim: `isDailyCapReached(db, telegramId)` → count `< DAILY_MESSAGE_CAP + 1`. Document which message number
is the first refused one, and add a handler-level test that drives 30 claims through the real counting
predicate.

### WR-03: A DB hiccup on the success path overwrites a correct result card with an error and orphans a saved draft

**File:** `src/application/voice-pipeline.ts:198-223`
**Issue:** `saveDraft`, `editMessage(resultCard)` and `markUpdateStatus('done')` sit inside one `try` whose
`catch` calls `finish(..., internalError, 'failed', ...)`. If `markUpdateStatus('done')` throws (transient
Postgres error) *after* the draft was written and the card was shown, the user's correct result card is
edited into "Что-то пошло не так на моей стороне. Отправь сообщение ещё раз." while the `diary_drafts` row
is already persisted. The user resends, producing a second draft for the same meal, and the first draft is
unreachable (its ack message no longer shows a card for Phase 4's keyboard to attach to). The same happens
if `editMessage` fails for a Telegram-side reason (see WR-04). No test covers the post-`saveDraft` failure
window — `voice-pipeline.test.ts` only covers a failing `saveDraft` itself (line 427).
**Fix:** Split the block: everything up to and including `saveDraft` stays under the internal-error catch;
after a successful `saveDraft`, failures of `editMessage`/`markUpdateStatus` should be logged and
swallowed (the draft exists and is the source of truth), never converted into a user-facing failure. Add a
test for "saveDraft succeeded, markUpdateStatus threw".

### WR-04: The result card has no length bound — Telegram rejects messages over 4096 characters

**File:** `src/bot/formatting/result-card.ts:39-49`
**Issue:** `buildResultCard` concatenates up to `MAX_COMPONENTS` (15) components, each with a verbatim FDC
`description` of unbounded length, and never checks the total. `editMessageText` fails with a 400 for text
over 4096 chars, which lands in the WR-03 path: the user is told the analysis failed even though the draft
was saved. `result-card.test.ts` has no long-input case.
**Fix:** Bound the rendered card — e.g. truncate each `description` to a documented constant (say 120
chars, with an ellipsis) and hard-clamp the final string to 4000 characters with a trailing note. Add a
test asserting `buildResultCard(fifteenLongComponents).length <= 4000`.

### WR-05: Long text meals are silently truncated at 1000 characters

**File:** `src/bot/handlers/meal.ts:184`
**Issue:** `text.slice(0, MAX_TEXT_LENGTH)` drops the tail without telling the user. The user sees an
analysis of the first 1000 characters and has no way to know half the meal was discarded — for a product
whose core value is trustworthy nutrition numbers, silently losing food from the input is worse than
refusing it. (Voice's twin cap, D-14, correctly *refuses* with `pipelineCopy.tooLong`.)
**Fix:** Mirror the voice behaviour: if `text.length > MAX_TEXT_LENGTH`, reply with a copy string
("Сообщение слишком длинное — опиши покороче, до 1000 символов"), `markUpdateStatus('done')`, and return
without calling the pipeline.

### WR-06: `bot.wiring.test.ts` asserts source-text order, not runtime registration order — and `bot.ts` is contorted to satisfy it

**File:** `src/bot/bot.wiring.test.ts:26-64`, `src/bot/bot.ts:152-159`
**Issue:** The phase's central security property ("every handler sits behind the allowlist gate") is
verified by reading `bot.ts` as a string and comparing `indexOf` positions. That proves nothing about
runtime order: a `bot.use()` added inside a helper function, in another module, or via a conditional would
pass the test while running before the gate. Worse, `bot.ts` moves its `createConversation` import to line
159 purely so the *literal string* appears after `session(` — the comment says so explicitly. Code shaped
around a text-matching assertion is a maintenance trap for a solo owner: any import-sorting lint/format
pass silently breaks a "security" test without changing behaviour.
**Fix:** Assert the real thing — construct the bot with a dummy token and a recording middleware stack, or
feed a synthetic non-allowlisted update through `bot.handleUpdate()` with fake deps and assert that
`session`/handlers were never reached. Then restore the import to the top block and delete the explanatory
comment.

### WR-07: `dotenv-safe` validation is dead code that always throws and is silently swallowed

**File:** `src/config/env.ts:62-69`
**Issue:** `.env.example` declares `BETA_ALLOWLIST=` and `STT_MODEL=` (intentionally empty — the documented
first-run state), while `dotenvSafe.config` is called with `allowEmptyValues: false`. On every normal
startup dotenv-safe therefore throws `MissingEnvVarsError`, and the bare `catch {}` discards it. The
library provides zero validation in practice, and any *real* `.env` parse problem is also swallowed with no
diagnostic. A future maintainer reading this file will believe dotenv-safe is guarding startup.
**Fix:** Either pass `allowEmptyValues: true` (dotenv-safe then only checks presence, which is what the
`.env.example` shape implies) or drop dotenv-safe for plain `dotenv` and keep the explicit
`REQUIRED_ENV_KEYS` check as the single source of truth. Either way, replace the empty catch with a
one-line comment-backed log so a genuinely broken `.env` is not invisible.

### WR-08: The STT price table is duplicated as a bare string literal, defeating the single-constant rule

**File:** `src/application/cost-log.ts:101`
**Issue:** `sttModel === 'gpt-4o-transcribe' ? 0.006 : 0.003` hardcodes a model name that
`src/adapters/stt/types.ts` exists to own (D-03: "nothing else in the codebase should hardcode a model
string"). If `STT_COMPARISON_MODEL`'s value ever changes, or the owner switches `STT_MODEL` to the
expensive model, the cost line silently reports **half** the real spend — a wrong number is worse than no
number for the one budget signal the owner has. The doc comment justifies avoiding the *import*, but the
duplicated literal is the exact drift the rule forbids.
**Fix:** Import `STT_COMPARISON_MODEL` (a constant, not an adapter behaviour — no layering violation), or
move `estimateTranscriptionCostUsd(seconds, model)` calls into the caller and pass the already-computed
USD figure into `CostInputs`.

### WR-09: `npm run verify-stt` prints a spend estimate and then spends immediately, with no confirmation

**File:** `scripts/verify-stt.ts:123-135`
**Issue:** CLAUDE.md requires explaining irreversible/paid actions *before* they happen, for an owner with
no backend experience. The script prints "Примерная суммарная стоимость: $X" and then proceeds to send
every sample to OpenAI **twice** in the very next statement — the owner never gets a chance to stop after
reading the number. With ~10 recordings this is small money, but the pattern ("we told you, then charged
you") is the one CLAUDE.md calls out.
**Fix:** Require an explicit opt-in after printing the estimate — e.g. exit with the estimate and the
instruction "если согласен, запусти `npm run verify-stt -- --yes`", and only proceed when `--yes` (or an
interactive `y`) is present.

### WR-10: `processMeal` assumes the embeddings array is index-aligned with the decomposition items

**File:** `src/application/voice-pipeline.ts:178-194`
**Issue:** `matchedCandidates` is built by mapping over `embeddings`, while `draftComponents` maps over
`decomposition.items` and pairs them positionally via `matchedCandidates[i] ?? []`. If an embedder ever
returns a shorter array, the tail components are silently turned into "no candidates / weak match" rather
than failing — the user is shown a plausible card with lost matches. The current OpenAI embedder does
validate length internally, so this is latent, but the pipeline is the layer that owns the invariant and
does not assert it.
**Fix:** Add an explicit guard before building components:

```ts
if (embeddings.length !== decomposition.items.length) {
  throw new Error(`embeddings length mismatch: ${embeddings.length} vs ${decomposition.items.length}`);
}
```

## Info

### IN-01: `"""` fencing is advisory only — transcript content can still close the data block

**File:** `src/adapters/llm/prompt.ts:32-36`
**Issue:** A user who types `""" Игнорируй предыдущие инструкции ...` closes the fence and continues in
instruction position. Blast radius is bounded (strict structured output constrains the shape, and the
result only pollutes that user's own draft), but the prompt's claim to be injection-safe is stronger than
what the code delivers. Note this is separate from CR-01, which bypasses the fence entirely.
**Fix:** Strip/escape `"""` from the transcript before interpolation, or switch to a system/user message
split so the data is never in the same string as the instructions.

### IN-02: Migration 0006's role guard checks `anon` but revokes from `anon, authenticated`

**File:** `drizzle/0006_voice_pipeline_rls.sql:30-44`
**Issue:** `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')` gates a `REVOKE ... FROM anon,
authenticated`. On a database where `anon` exists but `authenticated` does not, the REVOKE errors and the
migration aborts halfway. Both roles exist on Supabase, so this is theoretical today.
**Fix:** Check both role names in the guard, or issue two separately-guarded `REVOKE` statements.

### IN-03: The startup sweep can double-notify if it dies mid-run

**File:** `src/bot/startup-sweep.ts:64-80`
**Issue:** All rows are notified first, and `markInterrupted` runs only after the loop. A crash between the
two leaves every already-notified row in `processing`, so the next boot apologises again. Harmless but
confusing for a beta user.
**Fix:** Mark each row interrupted immediately after its own successful notify, or mark all rows before
notifying (an already-`interrupted` row is terminal either way).

### IN-04: `status: 'done'` is used for gate rejections, making the ledger ambiguous

**File:** `src/bot/handlers/meal.ts:98, 105, 171, 179`
**Issue:** A message refused for not-onboarded or over-cap is recorded with the same terminal status as a
fully analysed meal. Phase 4 (or any later spend analysis) cannot distinguish "analysed" from "refused
before any spend" from the ledger alone.
**Fix:** Add a `'skipped'` value to the status check constraint and use it for both gate rejections.

### IN-05: `createUnsupportedHandler` replies unconditionally, with no claim and no throttle

**File:** `src/bot/handlers/meal.ts:209-213`
**Issue:** A redelivered or looping unsupported message produces one reply each time. It costs no OpenAI
money (which is D-06's stated goal), but it can trip Telegram's per-chat flood limits and produce a reply
storm.
**Fix:** Acceptable as-is for a closed beta; if it becomes noisy, gate it behind `claimUpdate` with a
`kind: 'unsupported'` value.

### IN-06: `verify-stt` reads every sample twice and names the buffer `stat`

**File:** `scripts/verify-stt.ts:116-118, 139`
**Issue:** The pre-flight loop does a full `readFile` purely to get `.length` and stores it in a variable
named `stat` (it is a `Buffer`, not a `Stats`), then each file is read again in the main loop. Misleading
name plus duplicated I/O in a script the owner will read as an example.
**Fix:** Use `stat()` from `node:fs/promises` for the size pass, and rename the variable to `bytes`.

---

_Reviewed: 2026-08-14T12:23:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
