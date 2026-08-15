---
phase: 04-confirm-correct-diary-persistence
plan: 10
subsystem: bot
tags: [typescript, vitest, telegram, grammy, spend-control, wiring]

requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 09
    provides: "createCorrectionCallbackHandler(deps) — the single crc: dispatcher (correction.ts); the awaiting_input double-duty contract (sel writes it, not just gtype)"
  - phase: 04-confirm-correct-diary-persistence
    plan: 07
    provides: "applyTypedGrams/addComponent/parseGrams/MAX_COMPONENT_TEXT_LENGTH (corrections.ts)"
  - phase: 04-confirm-correct-diary-persistence
    plan: 04
    provides: "findAwaitingDraft (draft-store.ts) — the D-04 text-gate lookup"
  - phase: 03-voice-pipeline
    provides: "buildMealHandlerDeps/pipeline-wiring.ts's construct-once discipline; meal.ts's numbered gate order"
provides:
  - "src/bot/handlers/meal.ts: gate 0.5 (createTextHandler) — the D-04 awaiting-input interceptor, injectable, running before claimUpdate"
  - "src/bot/handlers/correction.ts: handleAwaitingText + createCorrectionTextHandler — the typed-grams/add-component dispatch and redraw"
  - "src/bot/correction-wiring.ts: buildCorrectionHandlerDeps(w) — construct-once wiring, reuses mealDeps' embedder/repo"
  - "src/bot/bot.ts: crc: callbackQuery registration and the wired text-gate interceptor, both behind the allowlist gate"
  - "registration-order + gate-order tripwires in bot.wiring.test.ts / bot.wiring.runtime.test.ts"
affects: []

tech-stack:
  added: []
  patterns:
    - "Gate 0.5 in createTextHandler resolves findOnboardedUser ONCE and reuses the result at gate 2, rather than querying twice — the D-04 interceptor and the not-onboarded check share one lookup"
    - "handleAwaitingText redraws the ORIGINAL card via a one-off EditableTextCtx wrapping ctx.api.editMessageText pinned to draft.chatId/draft.messageId — never ctx.editMessageText, since the triggering ctx is the user's own just-sent text message, not the card"
    - "correction-wiring.ts accepts embedder/repo as pass-through parameters (defaulting to constructing its own via the same factories only as a fallback) so bot.ts can reuse mealDeps.deps.embedder/repo — exactly one OpenAI embedder instance exists at runtime"

key-files:
  created:
    - src/bot/correction-wiring.ts
  modified:
    - src/bot/handlers/meal.ts
    - src/bot/handlers/meal.test.ts
    - src/bot/handlers/correction.ts
    - src/bot/handlers/correction.test.ts
    - src/bot/bot.ts
    - src/bot/bot.wiring.test.ts
    - src/bot/bot.wiring.runtime.test.ts

key-decisions:
  - "interceptCorrectionText's signature is `(ctx, user: {id, timezone}) => Promise<boolean>` — it takes the ALREADY-RESOLVED user rather than re-resolving it from ctx.from.id itself. This was chosen over having createCorrectionTextHandler do its own findOnboardedUser call because the plan's own interface note is explicit that gate 0.5 must hoist findOnboardedUser and gate 2 must reuse its result rather than querying Postgres twice per text message; a self-resolving interceptor would have made that impossible."
  - "meal.ts does not import application/corrections.js (the FDC-matching module) or any embedder — interceptCorrectionText is a plain injected function with no default real implementation in meal.ts itself. bot.ts is the only place that wires the real one (via correction-wiring.ts + createCorrectionTextHandler), keeping meal.test.ts free of any embedder construction, per the plan's explicit constraint."
  - "correction-wiring.ts's buildCorrectionHandlerDeps accepts embedder/repo as optional pass-through parameters with the same createOpenAIEmbedder/createDrizzleFdcRepository factories as its own fallback (never invoked at runtime, since bot.ts always passes mealDeps.deps.embedder/repo) — this satisfies both 'only one embedder instance may exist at runtime' and the acceptance criterion that both wiring files reference the same factory function."
  - "addComponent's 'match_failed' (hard embed failure, nothing appended) and a success with an empty candidates array (component appended, but with candidates: []) are both surfaced to the user as correctionCopy.addNotFound — reconciling the plan action text's single sentence covering both cases into two code paths that differ only in whether the new component is present in the redrawn card."

requirements-completed: [CORRECT-04, CORRECT-06, CORRECT-07]

duration: 55min
completed: 2026-08-15
---

# Phase 04 Plan 10: Text-Gate Routing and Composition-Root Registration Summary

**A typed reply during a correction (a grams number, an added-ingredient name) is now routed into the draft it belongs to via a Postgres-backed lookup that runs BEFORE the idempotency claim and any paid call, closing the D-04 loop and registering every Phase 4 handler behind the allowlist gate.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-15T16:58:00Z
- **Completed:** 2026-08-15T17:12:00Z
- **Tasks:** 3
- **Files created:** 1
- **Files modified:** 6

## Accomplishments

- `meal.ts`'s `createTextHandler` gained gate 0.5 — the D-04 awaiting-input check — inserted BEFORE `claimUpdate`, so a typed correction value can never buy a transcription or a decomposition (04-RESEARCH.md Pitfall 2). The user lookup gate 2 used to perform a second time is hoisted to gate 0.5 and reused, so `findOnboardedUser` is queried exactly once per text message.
- `correction.ts` gained `handleAwaitingText` (dispatches `typed_grams`/`add_component` input into `applyTypedGrams`/`addComponent` and redraws the ORIGINAL card via `ctx.api.editMessageText` pinned to `draft.chatId`/`draft.messageId`, never the user's own message) and `createCorrectionTextHandler` (the thin `findAwaitingDraft` + dispatch wrapper meal.ts's gate 0.5 calls).
- An invalid typed-grams value redraws level 2 with `correctionCopy.gramsRejected` and leaves the awaiting flag set (`applyTypedGrams` does not clear it on that path) — the user can just type again without re-tapping `⌨ Ввести граммы` (CORRECT-04).
- An over-long added-component text is rejected by `addComponent`'s length bound BEFORE the embedder is called — asserted end-to-end through the handler with zero embedder invocations (T-04-03/CORRECT-06).
- `src/bot/correction-wiring.ts` (new) mirrors `pipeline-wiring.ts`'s construct-once discipline and reuses `mealDeps.deps.embedder`/`mealDeps.deps.repo` so only ONE `Embedder` instance exists per process (T-04-36).
- `bot.ts` registers `bot.callbackQuery(CRC_PATTERN, createCorrectionCallbackHandler(correctionDeps))` and wires `mealDeps.interceptCorrectionText`, both behind the section-1 allowlist gate (T-04-08); the single `bot.on('message:text', ...)` registration stays the only text registration (no competing second registration, T-04-35).
- Registration-order and gate-order tripwires extended in `bot.wiring.test.ts` (crc: callbackQuery index > allowlist call-site index; exactly one `message:text` registration; no `ctx.reply(` in `correction.ts`) and `bot.wiring.runtime.test.ts` (the binding proof that the `crc:` registration happens after the allowlist `use()` call at runtime), plus the D-04 spend-control tripwire: the awaiting-input interception call precedes `claimUpdate(` inside `createTextHandler`'s own body.

## Task Commits

Each task was committed atomically:

1. **Task 1: The D-04 awaiting-input gate and the correction text handler** — `edcd672` (feat)
2. **Task 2: correction-wiring and composition-root registration** — `07bec69` (feat)
3. **Task 3: Registration-order tripwires for the Phase 4 handlers** — `9c180aa` (test)

## Files Created/Modified

- `src/bot/handlers/meal.ts` — new gate 0.5 in `createTextHandler`; new injectable `interceptCorrectionText` on `MealHandlerDeps`; module header updated with the gate's rationale
- `src/bot/handlers/meal.test.ts` — updated the happy-path order assertion for the hoisted `findOnboardedUser` call; two new tests for the D-04 interception (consumed vs. not-awaiting)
- `src/bot/handlers/correction.ts` — `handleAwaitingText`, `createCorrectionTextHandler`, three new injectable deps (`findAwaitingDraft`, `applyTypedGrams`, `addComponent`) on `CorrectionHandlerDeps`
- `src/bot/handlers/correction.test.ts` — five new tests for `handleAwaitingText` (typed-grams success/rejection, add-component success/too-long, expired-mid-dispatch) and two for `createCorrectionTextHandler`
- `src/bot/correction-wiring.ts` (new) — `buildCorrectionHandlerDeps(w)`
- `src/bot/bot.ts` — builds `correctionDeps`, registers the `crc:` callback and wires the text interceptor
- `src/bot/bot.wiring.test.ts` / `src/bot/bot.wiring.runtime.test.ts` — the Task 3 tripwires described above

## Decisions Made

See `key-decisions` in frontmatter — the interceptor's pre-resolved-user signature, keeping `meal.ts` free of any embedder import, `correction-wiring.ts`'s pass-through-with-fallback shape for the single-embedder guarantee, and the reconciliation of `addComponent`'s `match_failed`/no-candidates cases into two code paths sharing one Russian message.

## Deviations from Plan

None architecturally. Two implementation-detail adjustments worth flagging, both within the plan's own stated design space (not `[Rule N]` auto-fixes — no bug was found, no missing functionality was added beyond what the plan specified):

1. Two doc-comment sentences (in `meal.ts` and `bot.ts`) initially contained the literal substrings `application/corrections.js` and `bot.on('message:text'` in prose, which would have made the plan's own acceptance-criteria greps (`grep -n "corrections.js..." meal.ts` returning nothing; `grep -c "bot.on('message:text'" bot.ts` returning exactly 1) fail even though no actual import/registration existed. Reworded both comments to describe the same fact without the literal matching substring.
2. `correction-wiring.ts`'s `buildCorrectionHandlerDeps` signature diverges slightly from the plan's illustrative `(w: { db; api; factories? })` sketch: it takes `embedder`/`repo` as optional pass-through parameters instead of `api`, since `CorrectionHandlerDeps` (as built in plan 09) never needed an `api` field — every redraw goes through `ctx`/`ctx.api`, not a separately-injected `Api`. This keeps the "only one embedder instance" acceptance criterion satisfiable without an unused parameter.

## Issues Encountered

None beyond the two doc-comment/grep interactions above, resolved inline during the same task before committing.

## User Setup Required

None — no external service configuration required. This plan touches only bot-layer TypeScript; no migration, no new environment variable.

## Next Phase Readiness

- The full Phase 4 correction loop is now closed end-to-end: draft persistence (04-04), corrections/confirm/delete application logic (04-07/04-08), the callback dispatcher (04-09), and this plan's text-gate routing + composition-root wiring all compose through `bot.ts`.
- `npm test` (687 tests across 49 files) and `npx tsc --noEmit` both pass clean at HEAD.
- No blockers identified for Phase 4 verification/closeout.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: src/bot/correction-wiring.ts
- FOUND: .planning/phases/04-confirm-correct-diary-persistence/04-10-SUMMARY.md
- FOUND commits: edcd672, 07bec69, 9c180aa, cdb4da6
