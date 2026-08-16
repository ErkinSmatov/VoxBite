---
status: diagnosed
phase: 04-confirm-correct-diary-persistence
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md, 04-07-SUMMARY.md, 04-08-SUMMARY.md, 04-09-SUMMARY.md, 04-10-SUMMARY.md]
started: 2026-08-15T09:00:00Z
updated: 2026-08-15T09:00:00Z
---

## Current Test

[testing halted at test 1 — every remaining test is unreachable]

## Tests

Walkthrough executed by the owner against `docs/phase-04-manual-checklist.md` with a live bot
(`npm run bot`) and a real Telegram client. Preconditions passed before the live steps:
`npm test` 687/687 green across 49 files, `npx tsc --noEmit` exit 0.

### 1. CORRECT-01 / D-01 / D-02 — two-level card renders on a real device with working buttons
expected: |
  A voice message describing a multi-ingredient dish produces the Phase 4 level-1 correction
  card: every component with grams and its FDC description, plus inline buttons (one per
  component, `✅ Подтвердить`, `➕ Добавить`). Tapping a component edits the SAME message into
  the single-component screen.
result: issue
reported: "Сценарий 1 Я получил такой текст на аудио, кнопок ни каких нет

Вот что я распознал:

тост — 2 г
Bread, wheat, toasted
⚠️ совпадение слабое, проверь

масло — 20 г
Butter, salted
⚠️ совпадение слабое, проверь

джем — 20 г
Jams and preserves
⚠️ совпадение слабое, проверь

блинчик — 2 г
Pancakes, plain, prepared from recipe
⚠️ совпадение слабое, проверь

сгущёнка — 50 г
Milk, canned, condensed, sweetened

чай — 250 г
Beverages, tea, Oolong, brewed
⚠️ совпадение слабое, проверь

Пока не сохранено — дальше подтверди или поправь разбор, и я посчитаю КБЖУ."
severity: blocker

### 2. CORRECT-03 / D-03 — swapping a candidate moves the mark and updates the ≈ preview
expected: tapping candidate 2 moves the selection mark and changes the preview line
result: blocked
blocked_by: prior-phase
reason: requires tapping a component button on the level-1 card; no buttons are delivered (test 1)

### 3. CORRECT-04 — grams adjust via ±10 г and via typed input
expected: grams and preview move on each tap; `⌨ Ввести граммы` then a typed `200 г` applies without starting a new analysis; `abc` yields `correctionCopy.gramsRejected`
result: blocked
blocked_by: prior-phase
reason: unreachable without the level-1 card keyboard (test 1)

### 4. CORRECT-05 / D-12 — removing all components reaches the empty state
expected: empty-state message appears, `✅ Подтвердить` gone, `➕ Добавить` remains
result: blocked
blocked_by: prior-phase
reason: unreachable without the level-1 card keyboard (test 1)

### 5. CORRECT-06 — adding a component by text costs one embedding, not a re-transcription
expected: typed `сметана 30` appears as a component with candidates; no transcription/decomposition spend
result: blocked
blocked_by: prior-phase
reason: unreachable without the level-1 card keyboard (test 1)

### 6. CORRECT-07 / D-04 — draft state survives killing and restarting the bot process
expected: after `Ctrl+C` and `npm run bot`, a typed number still applies to the same component in the same card; `diary_drafts.awaiting_input` held a value while the bot was down
result: blocked
blocked_by: prior-phase
reason: unreachable without the level-1 card keyboard (test 1). This is one of the two mandatory manual-only verifications in 04-VALIDATION.md and remains undischarged.

### 7. CALC-02 / D-09 — a component with no USDA sugar reads «нет данных», never 0
expected: preview line and saved card both show «нет данных» for sugar when `fdc_foods.sugar_g` is null
result: blocked
blocked_by: prior-phase
reason: unreachable — the saved-entry path is only reachable through the correction card (test 1). This is the second mandatory manual-only verification in 04-VALIDATION.md and remains undischarged.

### 8. D-10 — confirm is refused when a component has no FDC match
expected: confirmation refused, offending component named, offer to remove or re-describe
result: blocked
blocked_by: prior-phase
reason: unreachable without `✅ Подтвердить` (test 1)

### 9. CORRECT-02 / DIARY-01 / D-05 / D-07 — confirm writes exactly one diary row on the dictated day
expected: card becomes the saved entry; exactly ONE `diary` row with `local_date` equal to the dictation day; a second rapid confirm adds no row
result: blocked
blocked_by: prior-phase
reason: unreachable without `✅ Подтвердить` (test 1)

### 10. CORRECT-08 — a saved entry can be reopened and corrected
expected: `✎ Поправить` changes the `diary` row's numbers while `local_date` stays the same
result: blocked
blocked_by: prior-phase
reason: unreachable — no entry can be saved (test 9)

### 11. D-08 — deleting a saved entry asks Да/Нет first and really deletes
expected: `Нет` deletes nothing; `Да` removes the `diary` row and sets the linked draft to `abandoned`
result: blocked
blocked_by: prior-phase
reason: unreachable — no entry can be saved (test 9)

### 12. D-11 — a card older than 24 hours reports «устарел» and loses its buttons
expected: tapping any button on a >24h card yields the expiry message and the buttons disappear
result: blocked
blocked_by: prior-phase
reason: unreachable without buttons (test 1); additionally not testable on the implementation day, as the checklist itself notes

## Summary

total: 12
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 11

## Gaps

- truth: "On a real phone, the two-level card is readable and every button does what its label says (CORRECT-01..06, D-01, D-02)."
  status: failed
  reason: "User reported: the voice message produced a plain text card with no buttons at all — the Phase 3 read-only result card, ending with the Phase 3 line «Пока не сохранено — дальше подтверди или поправь разбор, и я посчитаю КБЖУ.»"
  severity: blocker
  test: 1
  root_cause: |
    The voice pipeline still renders the Phase 3 read-only card and attaches no keyboard, so no
    message ever carries a `crc:` callback button. `src/application/voice-pipeline.ts:285` calls
    `deps.editor.editMessage(args.chatId, args.ackMessageId, buildResultCard(draft))` — importing
    `buildResultCard` from `src/bot/formatting/result-card.js` (line 59) and passing no
    `reply_markup`. Every render that DOES attach a Phase 4 keyboard lives in
    `src/bot/handlers/correction.ts`, and each of those runs only in response to an incoming
    `crc:` callback query. The result is a closed loop: the dispatcher waits for a button press
    that nothing can produce, leaving the entire Phase 4 correction UI unreachable from the
    product's only entry point.

    This is a seam defect, not a defect inside any one plan. No plan in 04-01..04-11 owned
    "replace the initial card render": 04-06 built the card and keyboards, 04-09 built the
    callback dispatcher, 04-10 wired handler registration and the text gate. The bootstrap render
    belonged to none of them.

    It is simultaneously a test-coverage gap. 04-10 added registration-ORDER tripwires, but no
    test asserts that the message produced by a successful voice pipeline run carries a `crc:`
    inline keyboard. That is why 687 passing tests did not catch a completely unreachable feature.
  artifacts:
    - src/application/voice-pipeline.ts
    - src/bot/formatting/result-card.ts
    - src/bot/formatting/correction-card.ts
    - src/bot/keyboards/correction-keyboards.ts
  missing:
    - "Voice pipeline (and any other draft-creating entry point) must render the Phase 4 level-1 correction card with buildLevel1Keyboard attached, instead of the Phase 3 read-only result card."
    - "A regression test asserting the message delivered at the end of a successful voice pipeline run carries a crc: inline keyboard — an entry-point reachability tripwire, not a registration-order one."
    - "A decision on what remains of result-card.ts once nothing renders it (delete, or keep with an explicit note about who still uses it)."
  debug_session: ""

## Observations (not this phase's gap — recorded so they are not lost)

Two things the owner's transcript shows that belong to Phase 3's decomposition/matching quality,
not to Phase 4's correction flow. Recorded here for triage, deliberately NOT folded into the gap
above:

- Implausible gram estimates from the LLM decomposition: «тост — 2 г» and «блинчик — 2 г» are off
  by roughly an order of magnitude for those foods.
- «⚠️ совпадение слабое, проверь» appears on 5 of 6 components, suggesting the FDC embedding match
  is landing weakly across the board rather than on one unlucky ingredient.
