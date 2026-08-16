---
status: complete
phase: 04-confirm-correct-diary-persistence
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md, 04-08-SUMMARY.md, 04-09-SUMMARY.md, 04-10-SUMMARY.md, 04-12-SUMMARY.md]
started: 2026-08-15T09:00:00Z
updated: 2026-08-15T12:00:00Z
---

## Current Test

[testing complete — round 2 signed off by the owner]

## Rounds

**Round 1 (before gap closure)** — halted at test 1 with a blocker: the bot delivered a
keyboardless Phase 3 card, making the entire `crc:` correction UI unreachable. Tests 2-12 were
blocked as a consequence. Full diagnosis retained in the Gaps section below.

**Round 2 (after plan 04-12)** — owner re-ran `docs/phase-04-manual-checklist.md` from scenario 1
against a restarted bot and signed off with "approved", i.e. every testable scenario passed. The
sign-off was global rather than per-scenario; results below record that, and scenario 12 is
recorded as not tested rather than claimed as passed (see its entry).

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
