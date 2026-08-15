---
phase: 04-confirm-correct-diary-persistence
plan: 09
subsystem: bot
tags: [typescript, vitest, telegram, callback-query, idor, dispatch]

requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 06
    provides: "CRC_PATTERN/parseCrc + all five keyboard builders (correction-keyboards.ts); buildCorrectionCard/buildComponentEditCard/buildConfirmedCard (correction-card.ts)"
  - phase: 04-confirm-correct-diary-persistence
    plan: 07
    provides: "swapCandidate/adjustGrams/removeComponent/GRAM_STEP (corrections.ts)"
  - phase: 04-confirm-correct-diary-persistence
    plan: 08
    provides: "confirmMeal/recomputeSavedEntry/deleteSavedEntry/findBlockingComponent (confirm-meal.ts)"
  - phase: 04-confirm-correct-diary-persistence
    plan: 04
    provides: "readDraft/setAwaitingInput/clearAwaitingInput/markDraftStatus/claimAbandon (draft-store.ts), isDraftExpired (types.ts)"
provides:
  - "src/bot/handlers/correction.ts: createCorrectionCallbackHandler(deps) — the single crc: dispatcher"
  - "src/bot/handlers/correction.test.ts: gate-order, IDOR, expiry, dispatch and redraw coverage"
affects: [04-10-text-gate-routing, 04-11-registration]

tech-stack:
  added: []
  patterns:
    - "Six-step gate order (ack -> parseCrc -> identity -> scoped readDraft -> expiry -> dispatch) mirrors meal.ts's spend-control gate list, documented as a numbered module-header comment"
    - "Every dispatch branch redraws from the freshly-read `draft` object, never from `cb` alone — no branch trusts the tapped keyboard's implied state"
    - "One `editText` closure wraps safeEditMessageText with a single BotContext-to-EditableTextCtx cast, so every call site stays a plain safeEditMessageText call at the type level"

key-files:
  created:
    - src/bot/handlers/correction.ts
    - src/bot/handlers/correction.test.ts
  modified: []

key-decisions:
  - "Resolved the 04-06-flagged level-2 component-index contract gap (buildLevel2Keyboard's cand/gm/gp/gtype/rm/back buttons carry no component index in callback_data) by taking option (b) from the plan text: the selected component index is persisted on the draft row via the EXISTING awaiting_input jsonb column, reusing kind: 'typed_grams' rather than widening the DraftAwaitingInput schema. This works because typing a number is the ONLY free-text action level 2 offers, so 'the next free-text reply for this draft is grams for this component' is true the instant the user opens level 2 (sel), not just after they tap gtype — gtype is idempotent on top of sel's write, adding only the visible askGrams prompt. Every exit from level 2 (back, rm, add, cancel, confirm success) clears it via clearAwaitingInput so the state never leaks into an unrelated later message. This kept the plan's declared files_modified scope (correction.ts/correction.test.ts only) intact — no schema or draft-store.ts change was needed."
  - "A single `editCtx`/`editText` closure created once per handler invocation casts BotContext to safe-edit.ts's structurally-typed EditableTextCtx, because grammY's real editMessageText overload (Other<> parameter type) is not directly assignable to the deliberately loose `other?: unknown` parameter safe-edit.ts declares for its own two-line-fake testability. This keeps every call site a plain, readable `editText(text, other)` while the cast lives in exactly one place."
  - "On any correction-operation failure (swapCandidate/adjustGrams/removeComponent returning ok:false), the handler logs draftId+reason and redraws the current screen unchanged rather than surfacing a Russian error string not specified by the plan's copy module — a conservative default for edge cases outside the plan's 12 stated behaviors (stale/tampered indices, a write_failed race)."

requirements-completed: [CORRECT-01, CORRECT-02, CORRECT-03, CORRECT-04, CORRECT-05, CORRECT-08]

duration: 40min
completed: 2026-08-15
---

# Phase 04 Plan 09: Correction Handler Dispatch Summary

**One `crc:` callback-query dispatcher — ack → strict parse → identity → user-scoped draft read → D-11 expiry → action dispatch → same-message redraw — wiring every button from plan 06's keyboards into plan 07/08's operations, resolving the 04-06-flagged level-2 component-index gap by persisting selection state on the draft row's existing `awaiting_input` column instead of widening the schema.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-15T16:15:00Z
- **Completed:** 2026-08-15T16:58:00Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments

- `createCorrectionCallbackHandler(deps)` implements the full six-step gate order (ack, strict `parseCrc`, identity via `findOnboardedUser`, scoped `readDraft`, abandoned/expired checks, action dispatch), documented as a numbered module-header comment per `meal.ts`'s precedent.
- All 14 `CrcAction` values are handled in one exhaustive `switch` (TypeScript's `never` check on the `default` branch guarantees a new action added to the codec without a matching case is a compile error): `sel`, `cand`, `gm`, `gp`, `gtype`, `rm`, `back`, `add`, `confirm`, `cancel`, `edit`, `del`, `delno`, `delyes`.
- Resolved the component-index contract gap 04-06-SUMMARY.md flagged for this plan: `sel` persists the tapped component's index into `awaitingInput` (reusing the existing `{ kind: 'typed_grams', componentIndex }` shape), and every subsequent level-2 action reads it back via `draft.awaitingInput?.componentIndex` — no schema change, no `callback_data` widening.
- D-10's blocked-confirm, D-12's empty-state (no Подтвердить), and D-08's two-step delete (`del` only prompts, `delyes` actually deletes) are all implemented exactly as specified, and asserted by dedicated tests.
- Every redraw goes through one `editText` closure wrapping `safeEditMessageText`; `ctx.editMessageText`/`ctx.reply` never appear directly in the file (verified by the plan's own acceptance-criteria greps).
- `recomputeSavedEntry` is called after any mutating correction op (`cand`/`gm`/`gp`/`rm`) on a `status === 'confirmed'` draft, so an edited saved entry's diary snapshot never lags the visible card (CORRECT-08).

## Task Commits

Each task was committed atomically:

1. **Task 1: createCorrectionCallbackHandler — gates, dispatch and redraw** — `1466579` (feat)
2. **Task 2: correction.test.ts — gate order, IDOR, expiry and dispatch coverage** — `c58ca4e` (test)

## Files Created/Modified

- `src/bot/handlers/correction.ts` — `CorrectionHandlerDeps`, `createCorrectionCallbackHandler`; every collaborator (findOnboardedUser, readDraft, setAwaitingInput, clearAwaitingInput, markDraftStatus, claimAbandon, swapCandidate, adjustGrams, removeComponent, confirmMeal, recomputeSavedEntry, deleteSavedEntry) is an injectable override defaulting to the real import, plus an injectable `now()` clock for expiry testing
- `src/bot/handlers/correction.test.ts` — 12 tests: malformed-payload zero-db-calls (x3 payloads), foreign-draft/IDOR, 25-hour expiry, `cand`/`gp`/`gm` dispatch with parsed indices, `rm`-to-empty rendering with no Подтвердить, D-10 blocked confirm naming the component, D-05 confirmed card + keyboard, D-08's `del` (zero deletes) and `delyes` (confirmed:true, deleted copy), `edit` not itself recomputing but a subsequent correction does, and ack-before-db / readDraft-before-op ordering

## Decisions Made

See `key-decisions` in frontmatter — the level-2 component-index persistence approach, the `editText` cast closure, and the conservative silent-redraw-on-failure default are the three notable implementation choices, all documented in `correction.ts`'s own header/inline comments as well.

## Deviations from Plan

None architecturally. One scope-preserving implementation choice worth flagging explicitly: the plan's action text offered two options for the level-2 component-index gap ("(a) level-2 buttons carry both indices in callback_data, or (b) the selected component index is persisted on the draft row"); this plan took option (b) using the *existing* `awaiting_input` column rather than adding a new one, keeping the plan's declared `files_modified` (`correction.ts`/`correction.test.ts` only) exactly as written — no `[Rule N]` auto-fix was needed because this was resolving an explicitly-flagged open design choice within the plan's own stated options, not an unplanned bug or missing feature.

## Issues Encountered

One local TypeScript friction, fixed inline (not a deviation): `EditableTextCtx`'s `editMessageText(text: string, other?: unknown)` property-function signature is not directly assignable from grammY's real `Context.editMessageText` (whose `other` parameter has a narrower `Other<>` type) under TypeScript's strict property-function variance checking. Fixed by casting `ctx` to `EditableTextCtx` once per handler invocation into a local `editText` closure, so every call site remained a plain, readable call.

## User Setup Required

None — no external service configuration required. This plan touches only bot-layer TypeScript; no migration, no new environment variable.

## Next Phase Readiness

- Plan 10 (text-gate routing) can now register `createCorrectionCallbackHandler`'s output on `bot.callbackQuery(CRC_PATTERN, ...)` and build the plain-text routing gate (`findAwaitingDraft`) that consumes the same `awaitingInput` state this plan writes — specifically, plan 10 should be aware that `awaitingInput.kind === 'typed_grams'` is now set the moment a user opens ANY level-2 screen (on `sel`), not only after an explicit `gtype` tap; a free-text message sent while browsing level 2 (before tapping "⌨ Ввести граммы") will be routed as a grams answer by plan 10's gate if it reads this field literally. This is a deliberate, documented design choice (see key-decisions) — plan 10 does not need to special-case it, since `applyTypedGrams`'s own `parseGrams` already rejects non-numeric text without writing or clearing the awaiting flag (per 04-07-SUMMARY.md).
- Registration (`bot.callbackQuery(CRC_PATTERN, createCorrectionCallbackHandler(deps))`) and the text-path integration are explicitly out of this plan's scope — plan 10 owns both, so the registration-order assertions live in one place.
- No blockers identified.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: src/bot/handlers/correction.ts
- FOUND: src/bot/handlers/correction.test.ts
- FOUND: .planning/phases/04-confirm-correct-diary-persistence/04-09-SUMMARY.md
- FOUND commits: 1466579, c58ca4e
