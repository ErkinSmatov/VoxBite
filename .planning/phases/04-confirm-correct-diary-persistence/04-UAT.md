---
status: partial
phase: 04-confirm-correct-diary-persistence
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md, 04-08-SUMMARY.md, 04-09-SUMMARY.md, 04-10-SUMMARY.md, 04-12-SUMMARY.md]
started: 2026-08-15T09:00:00Z
updated: 2026-08-15T12:00:00Z
---

## Current Test

[round 3: owner tested text-based correction on an already-confirmed entry, found scenarios 3/5 leak into the paid pipeline — see round 3 below and the new Gaps entries]

## Rounds

**Round 1 (before gap closure)** — halted at test 1 with a blocker: the bot delivered a
keyboardless Phase 3 card, making the entire `crc:` correction UI unreachable. Tests 2-12 were
blocked as a consequence. Full diagnosis retained in the Gaps section below.

**Round 2 (after plan 04-12)** — owner re-ran `docs/phase-04-manual-checklist.md` from scenario 1
against a restarted bot and signed off with "approved", i.e. every testable scenario passed. The
sign-off was global rather than per-scenario; results below record that, and scenario 12 is
recorded as not tested rather than claimed as passed (see its entry).

## Round 3 (post-completion, code-review follow-up)

Owner independently re-tested scenario 3 step 3 (typed grams) and scenario 5 (add component by
text) — both against an entry the owner had already reopened via `✎ Поправить` after confirming
it, not a fresh untouched draft. Both leaked into the paid pipeline exactly as
`04-REVIEW.md` findings CR-01/CR-02 predicted (see Gaps below). Confirmed against live production
data, not merely re-read code: `diary_drafts` row `id=5` was found with `status='confirmed'` and
a dangling `awaiting_input={"kind":"add_component"}`, and a stray `diary` row `id=3` ("Говядина
45г", 91.35 kcal) exists as a duplicate/misrouted entry that should have been merged into the
already-saved meal (`diary id=2`) instead of becoming its own paid decomposition. The owner was
advised to delete the stray row themselves via the app's own `🗑 Удалить` flow rather than have it
edited by hand in the database.

## Tests

Preconditions confirmed on `main` before the live steps in both rounds:
`npx tsc --noEmit` exit 0; `npm test` green (687/687 in round 1, 680/680 across 51 files in
round 2 — the count dropped because `result-card.ts` and its test were retired in 04-12 and
replaced by `message-editor.test.ts` and `entry-point-reachability.test.ts`).

### 1. CORRECT-01 / D-01 / D-02 — two-level card renders on a real device with working buttons
expected: level-1 correction card with a button per component, `✅ Подтвердить` and `➕ Добавить`; tapping a component edits the SAME message into the single-component screen
result: pass
note: failed in round 1 (blocker, see Gaps); passed in round 2 after 04-12

### 2. CORRECT-03 / D-03 — swapping a candidate moves the mark and updates the ≈ preview
expected: tapping candidate 2 moves the selection mark and changes the preview line
result: pass

### 3. CORRECT-04 — grams adjust via ±10 г and via typed input
expected: grams and preview move on each tap; typed `200 г` applies without starting a new analysis; `abc` yields `correctionCopy.gramsRejected` and a valid number can follow without re-tapping
result: pass

### 4. CORRECT-05 / D-12 (Phase 4) — removing all components reaches the empty state
expected: empty-state message appears, `✅ Подтвердить` gone, `➕ Добавить` remains
result: pass

### 5. CORRECT-06 — adding a component by text costs one embedding, not a re-transcription
expected: typed `сметана 30` appears as a component with candidates; no transcription/decomposition spend
result: pass

### 6. CORRECT-07 / D-04 — draft state survives killing and restarting the bot process
expected: after `Ctrl+C` and `npm run bot`, a typed number still applies to the same component in the same card; `diary_drafts.awaiting_input` held a value while the bot was down
result: pass
note: one of the two mandatory manual-only verifications in 04-VALIDATION.md — now discharged

### 7. CALC-02 / D-09 — a component with no USDA sugar reads «нет данных», never 0
expected: preview line and saved card both show «нет данных» for sugar when `fdc_foods.sugar_g` is null
result: pass
note: the second mandatory manual-only verification in 04-VALIDATION.md — now discharged

### 8. D-10 — confirm is refused when a component has no FDC match
expected: confirmation refused, offending component named, offer to remove or re-describe
result: pass

### 9. CORRECT-02 / DIARY-01 / D-05 / D-07 — confirm writes exactly one diary row on the dictated day
expected: card becomes the saved entry; exactly ONE `diary` row with `local_date` equal to the dictation day; a second rapid confirm adds no row
result: pass

### 10. CORRECT-08 — a saved entry can be reopened and corrected
expected: `✎ Поправить` changes the `diary` row's numbers while `local_date` stays the same
result: pass

### 11. D-08 (Phase 4) — deleting a saved entry asks Да/Нет first and really deletes
expected: `Нет` deletes nothing; `Да` removes the `diary` row and sets the linked draft to `abandoned`
result: pass

### 12. D-11 — a card older than 24 hours reports «устарел» and loses its buttons
expected: tapping any button on a >24h card yields the expiry message and the buttons disappear
result: skipped
reason: no card older than 24 hours could exist — the feature was implemented the same day. `docs/phase-04-manual-checklist.md` explicitly permits recording this as untested rather than fabricating a pass. The expiry rule itself is covered by unit tests (`isDraftExpired` in `src/application/types.ts`, exercised in `draft-store.test.ts` and `correction.test.ts`); what remains unverified is only its on-device presentation.

## Summary

total: 12
passed: 11
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

- truth: "On a real phone, the two-level card is readable and every button does what its label says (CORRECT-01..06, D-01, D-02)."
  status: resolved
  resolved_by: 04-12
  reason: "User reported: the voice message produced a plain text card with no buttons at all — the Phase 3 read-only result card, ending with the Phase 3 line «Пока не сохранено — дальше подтверди или поправь разбор, и я посчитаю КБЖУ.»"
  severity: blocker
  test: 1
  root_cause: |
    The voice pipeline rendered the Phase 3 read-only card and attached no keyboard, so no
    message ever carried a `crc:` callback button. `src/application/voice-pipeline.ts:285` called
    `deps.editor.editMessage(args.chatId, args.ackMessageId, buildResultCard(draft))` — importing
    `buildResultCard` from `src/bot/formatting/result-card.js` (line 59) and passing no
    `reply_markup`. Every render that DID attach a Phase 4 keyboard lived in
    `src/bot/handlers/correction.ts`, and each of those ran only in response to an incoming
    `crc:` callback query. Closed loop: the dispatcher waited for a button press that nothing
    could produce, leaving the entire Phase 4 correction UI unreachable from the product's only
    entry point.

    A seam defect, not a defect inside any one plan. No plan in 04-01..04-11 owned "replace the
    initial card render": 04-06 built the card and keyboards, 04-09 built the callback dispatcher,
    04-10 wired handler registration and the text gate. The bootstrap render belonged to none.

    Simultaneously a test-coverage gap. 04-10 added registration-ORDER tripwires, but no test
    asserted that the message produced by a successful voice pipeline run carried a `crc:` inline
    keyboard. That is why 687 passing tests did not catch a completely unreachable feature.
  artifacts:
    - src/application/voice-pipeline.ts
    - src/bot/formatting/result-card.ts
    - src/bot/formatting/correction-card.ts
    - src/bot/keyboards/correction-keyboards.ts
  missing: []
  resolution: |
    Plan 04-12 introduced a bot-layer `DraftCardRenderer` port (`src/bot/telegram/draft-card-renderer.ts`)
    injected through `PipelineDeps` — the application layer cannot build the keyboard itself
    because `src/application/types.ts:6-10` forbids importing grammY there. `MessageEditor.editMessage`
    gained an optional opaque `replyMarkup` argument. `result-card.ts` and its test were deleted;
    the `isWeakMatch` doc comment in `types.ts` was repointed to `correction-card.ts`.

    Two regression tests now guard the seam, and BOTH were confirmed by the orchestrator to fail
    against deliberately re-broken code before being accepted:
    - `src/bot/telegram/message-editor.test.ts` — asserts the 4th argument reaches the Telegram
      API call and that its absence means exactly 3 arguments. Verified: removing the 4th argument
      fails this test.
    - `src/bot/entry-point-reachability.test.ts` — asserts the message delivered by a successful
      pipeline run carries an inline keyboard whose `callback_data` all parses via `parseCrc` to
      the persisted draft id, sourcing the renderer from the composition root so a swap inside
      `pipeline-wiring.ts` is caught too. Verified: reproducing the original bug (dropping
      `card.replyMarkup` from the `editMessage` call) fails this test on 2 assertions, including
      the text path.
  debug_session: ""

- truth: "A saved entry can be reopened, corrected via typed input (not just buttons), and the diary row's totals stay current (CORRECT-04/06/08)."
  status: failed
  reason: "User reported (round 3): typing '200 г' after tapping ⌨ Ввести граммы on a reopened saved entry, and typing a component description after tapping ➕ Добавить on a reopened saved entry, both leak into the paid voice/text pipeline instead of being applied as a correction. Confirmed against live data: diary_drafts id=5 (status='confirmed', awaiting_input={\"kind\":\"add_component\"}) and a stray diary row id=3 (\"Говядина 45г\", 91.35 kcal, draft_id=6) that should have been merged into diary id=2."
  severity: blocker
  test: "round-3 (not in the original 12; a scenario the checklist did not cover — text-based correction of an already-reopened saved entry)"
  root_cause: |
    Two independent, compounding defects, first identified by 04-REVIEW.md (CR-01, CR-02) from
    static code review and now confirmed live:

    CR-01 (routing): `case 'edit'` in `src/bot/handlers/correction.ts:379-383` moves a confirmed
    draft's card back into the level-1 editing view but does NOT reset the draft's `status` from
    `'confirmed'` back to `'draft'`. `findAwaitingDraft` (`src/application/draft-store.ts:113-121`)
    — the ONLY function the D-04 text gate (`meal.ts` gate 0.5 -> `interceptCorrectionText`) uses
    to decide whether typed text is a correction reply — filters on `status = 'draft'` specifically.
    Every button that sets `awaiting_input` (`sel`, `gtype`, `add` in `correction.ts`) does so
    unconditionally, regardless of the draft's current status, so `awaiting_input` gets set on a
    `'confirmed'` row with no matching read path. The typed reply then falls through `meal.ts`'s
    normal gate sequence and is processed by `processMeal` as an unrelated new meal message —
    a real, metered OpenAI spend (decomposition + embedding) for text that was never meant to be
    a new dish.

    CR-02 (staleness, would surface once CR-01 is fixed): even after routing correctly,
    `handleAwaitingText` (`src/bot/handlers/correction.ts` ~518-570) never calls
    `recomputeSavedEntry`, unlike every button-driven correction path (`cand`/`gm`/`gp`/`rm` all
    call it when `draft.status === 'confirmed'`). A text-based correction of a saved entry would
    silently leave the `diary` row's kcal/protein/fat/carbs/sugar unchanged even after the
    underlying components changed.
  artifacts:
    - src/bot/handlers/correction.ts
    - src/application/draft-store.ts
  missing:
    - "A decision, made explicit in a plan (not left to the executor): does `case 'edit'` transition the draft's status back to `draft` for the duration of editing (and if so, what un-transitions it — a new confirm claim, a timeout, an explicit 'done editing' action?), OR does `findAwaitingDraft` widen its filter to also match `status = 'confirmed'` rows? These have different consequences for `diary_id`/CAS semantics and must be chosen deliberately, the same way 04-12's plan review forced an explicit choice rather than a guess."
    - "handleAwaitingText calling recomputeSavedEntry when the draft's status is 'confirmed', mirroring the button handlers exactly."
    - "A regression test exercising this specific path end to end: reopen a confirmed entry via 'edit', trigger a text-based correction (typed grams or add-component), and assert (a) no paid-pipeline call was made and (b) the diary row's totals reflect the correction. This exact scenario existed in neither the automated suite nor `docs/phase-04-manual-checklist.md` — both covered button-based editing (scenario 10) and text-based correction of a FRESH draft (scenarios 3, 5) but never their combination."
  debug_session: ""

## Observations (not this phase's gap — routed to Phase 3 triage)

Recorded from round 1's transcript. These belong to Phase 3's decomposition/matching quality, not
to Phase 4's correction flow, and were deliberately excluded from the 04-12 gap closure:

- Implausible gram estimates from the LLM decomposition: «тост — 2 г» and «блинчик — 2 г» are off
  by roughly an order of magnitude for those foods.
- «⚠️ совпадение слабое, проверь» appeared on 5 of 6 components, suggesting the FDC embedding match
  is landing weakly across the board rather than on one unlucky ingredient.

Both bear directly on the product's core value (trustworthy KБЖУ numbers) and are worth a
dedicated look — the correction UI lets a user fix a bad match, but it does not make the matches
good.
