---
phase: 04-confirm-correct-diary-persistence
plan: 12
subsystem: bot+application
tags: [typescript, vitest, telegram, grammy, gap-closure, regression-test]

requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 06
    provides: "buildCorrectionCard/buildLevel1Keyboard (correction-card.ts, correction-keyboards.ts) — the Phase 4 card and keyboard this plan finally wires into the pipeline's success render"
  - phase: 04-confirm-correct-diary-persistence
    plan: 10
    provides: "the full crc: dispatcher and text-gate routing this plan makes reachable for the first time"
provides:
  - "DraftCardRenderer/RenderedCard port (application/types.ts) + createDraftCardRenderer() (bot/telegram/draft-card-renderer.ts) — the deps-injected bot-layer card renderer voice-pipeline.ts now calls on every success path"
  - "MessageEditor.editMessage's 4th replyMarkup parameter + createMessageEditor's { reply_markup } forwarding (message-editor.ts) — the last-mile plumbing that reaches the real Telegram API"
  - "src/bot/entry-point-reachability.test.ts — the reachability tripwire that fails if a pipeline run ever again delivers a keyboardless card"
affects: []

tech-stack:
  added: []
  patterns:
    - "DraftCardRenderer built once at the composition root (pipeline-wiring.ts) alongside the editor, injected into PipelineDeps — the same construct-once discipline every other collaborator in that file follows"
    - "MessageEditor.editMessage's 4th parameter is optional and forwarded only when defined, so every pre-existing 3-argument call site (all four failure paths) is byte-for-byte unchanged"

key-files:
  created:
    - src/bot/telegram/draft-card-renderer.ts
    - src/bot/telegram/draft-card-renderer.test.ts
    - src/bot/telegram/message-editor.test.ts
    - src/bot/entry-point-reachability.test.ts
  modified:
    - src/application/types.ts
    - src/application/voice-pipeline.ts
    - src/application/voice-pipeline.test.ts
    - src/bot/telegram/message-editor.ts
    - src/bot/pipeline-wiring.ts
    - src/bot/pipeline-wiring.test.ts
    - src/bot/formatting/correction-copy.ts
    - src/bot/formatting/correction-card.ts
    - .planning/phases/04-confirm-correct-diary-persistence/04-VALIDATION.md
  deleted:
    - src/bot/formatting/result-card.ts
    - src/bot/formatting/result-card.test.ts

key-decisions:
  - "The correction card and its crc: keyboard are built in the BOT layer (src/bot/telegram/draft-card-renderer.ts), not inside src/application/, and handed to the pipeline through deps — because buildLevel1Keyboard imports grammY's InlineKeyboard and types.ts rule 1 forbids the application layer from importing grammY. DraftCardRenderer is constructed once at the composition root (pipeline-wiring.ts) alongside the editor, mirroring how correction-wiring.ts injects embedder/repo."
  - "result-card.ts and result-card.test.ts were DELETED, not kept alongside correction-card.ts. correction-card.ts supersedes it completely and deliberately does not reuse its formatComponent (result-card.ts always renders candidates[0]; Phase 4 must render the user's CHOSEN candidate). Leaving a keyboardless card renderer in the tree is exactly the trap that produced 04-UAT.md's blocker, so this was a retirement, not a refactor-into-one. .planning/phases/03-voice-pipeline/03-VERIFICATION.md was left untouched as the historical record of Phase 3; the supersession is recorded here instead."
  - "types.ts's isWeakMatch doc comment, which named result-card.ts as one of the two sides of the weakMatch invariant, was rewritten to point at correction-card.ts (the Phase 4 renderer) without repeating the literal string 'result-card.ts' in prose, since the plan's own <verify> grep allowlist only exempts correction-copy.ts and correction-card.ts from mentioning result-card."
  - "MessageEditor.editMessage's replyMarkup is typed unknown at the application layer -- the pipeline forwards it opaquely from DraftCardRenderer.renderLevel1's RenderedCard to editor.editMessage without ever inspecting its shape, keeping src/application/ ignorant of Telegram's InlineKeyboard type."

requirements-completed: []

duration: ~50min
completed: 2026-08-16
---

# Phase 04 Plan 12: Gap Closure — Unreachable Correction Card Summary

**Closes 04-UAT.md's single blocker: the voice/text pipeline now renders the Phase 4 level-1 correction card WITH its `crc:` inline keyboard on every successful run (voice and text), via a bot-layer `DraftCardRenderer` injected into `PipelineDeps`, and `result-card.ts` (the old keyboardless Phase 3 card) is retired; a new reachability tripwire proves the fix and fails if the render change is ever reverted.**

## What This Plan Does NOT Discharge

**Read this before marking anything Done.** This plan implements none of
CORRECT-01..08, CALC-01, CALC-02, or DIARY-01 — plans 04-01..04-10 already
built all of that. This plan's `requirements` frontmatter lists them only
because that is how gap-closure traceability works in this workflow, not
because this plan delivers them. All this plan does is make them
**reachable** by fixing the seam defect that left every message in the
product without a `crc:` keyboard.

Both mandatory manual-only verifications in `04-VALIDATION.md` remain
**OPEN**:
- **CORRECT-07** (a draft survives killing and restarting the bot process)
- **CALC-02** («нет данных» shown for a null-sugar FDC record, end to end on
  a real Telegram client)

Neither can be discharged by a green test suite. Both require the owner to
re-run `docs/phase-04-manual-checklist.md` against a live bot. `REQUIREMENTS.md`
must not be marked Done for CORRECT-01..08/CALC-01/CALC-02/DIARY-01 on the
strength of this plan alone — that is precisely the mistake (687 green tests,
zero working buttons) that produced this gap in the first place.

## The Two Mandatory Revert-Checks

Both were performed and confirmed before this SUMMARY was written:

1. **Dropping the 4th argument inside `createMessageEditor`'s `editMessage`
   fails `message-editor.test.ts`.** Verified by temporarily reverting
   `message-editor.ts`'s implementation to the pre-plan 3-argument-only
   version and re-running the test — the "FOUR arguments" assertion failed
   with `expected [ 555, 42, 'hello' ] to have a length of 4 but got 3`.
   Reverted back to the correct implementation; test file re-confirmed green.
2. **Reverting Task 2's render change makes the entry-point-reachability
   tripwire fail.** Verified by temporarily dropping `card.replyMarkup` from
   `voice-pipeline.ts`'s success-path `editor.editMessage(...)` call and
   re-running `entry-point-reachability.test.ts` — both the voice and text
   success assertions failed with `expected undefined to be defined` on the
   `replyMarkup` check. Reverted back; `git diff src/application/voice-pipeline.ts`
   confirmed a clean diff against the committed Task 2 state before re-running
   the full suite.

Both tests are therefore load-bearing, not decorative.

## Task Commits

1. **Task 1: card-render port + bot-layer implementation** — `279b232` (feat)
   — `DraftCardRenderer`/`RenderedCard` in `types.ts`, `MessageEditor`'s
   optional 4th param, `createDraftCardRenderer()`, and the two new test
   files (`draft-card-renderer.test.ts`, `message-editor.test.ts`).
2. **Task 2: render the level-1 card from the pipeline, retire result-card.ts**
   — `9a6a811` (feat) — `voice-pipeline.ts` now captures `saveDraft`'s
   returned id and calls `cardRenderer.renderLevel1`; `pipeline-wiring.ts`
   constructs the renderer once; `result-card.ts`/`result-card.test.ts`
   deleted; `types.ts`'s `isWeakMatch` comment repointed; `04-VALIDATION.md`
   updated with T1/T2 rows.
3. **Task 3: entry-point reachability tripwire** — `e7ed9be` (test) —
   `src/bot/entry-point-reachability.test.ts`, sourcing the renderer from
   `buildMealHandlerDeps` (the composition root), not a direct import.
4. **04-VALIDATION.md T3 status update** — `40d60ea` (docs) — marked the T3
   row green after the tripwire was confirmed passing (small follow-up
   commit since the row's status could only be set after Task 3's own commit
   had already landed).

## Files Created/Modified

- `src/application/types.ts` — `RenderedCard`, `DraftCardRenderer` port;
  `MessageEditor.editMessage` gains optional `replyMarkup?: unknown`;
  `isWeakMatch`'s doc comment repointed off the deleted `result-card.ts`
- `src/bot/telegram/draft-card-renderer.ts` (new) — `createDraftCardRenderer()`,
  the only renderer the pipeline is allowed to call
- `src/bot/telegram/draft-card-renderer.test.ts` (new) — 5 tests covering the
  `<behavior>` block: header+component names present, every callback matches
  `CRC_PATTERN`, every parsed callback carries the passed-in draftId, confirm+add
  present for a non-empty list, D-12 empty state (add+cancel, no confirm)
- `src/bot/telegram/message-editor.ts` — `EditableApi.editMessageText` gains
  optional 4th param; `createMessageEditor` forwards `{ reply_markup }` only
  when `replyMarkup` is defined, else calls with exactly 3 arguments
- `src/bot/telegram/message-editor.test.ts` (new, module had zero prior tests)
  — 3 tests: 4-argument forward with exact deep-equal, exactly-3-argument
  no-markup case, no `parse_mode` ever appears in the 4th argument
- `src/application/voice-pipeline.ts` — `PipelineDeps` gains `cardRenderer:
  DraftCardRenderer`; success path captures `draftId` from `saveDraft`,
  calls `cardRenderer.renderLevel1(draftComponents, draftId)`, edits with
  `card.text, card.replyMarkup`; module doc comment step 7 updated; unused
  local `draft: MealDraft` removed
- `src/application/voice-pipeline.test.ts` — `fakeCardRenderer()` added;
  all 20 `PipelineDeps` literals updated; new assertions for a defined
  `replyMarkup` on success, `renderLevel1` called once with the persisted
  components and the exact `saveDraft`-returned id (including a non-1 id,
  4321, so a hardcoded 0/1 could not pass by accident), and `replyMarkup`
  undefined / `renderLevel1` never called on the no-food and all three
  failure paths
- `src/bot/pipeline-wiring.ts` — constructs `createDraftCardRenderer()` once
  alongside the editor, adds `cardRenderer` to the `PipelineDeps` literal
- `src/bot/pipeline-wiring.test.ts` — "all six" → "all seven" fields,
  asserts `result.deps.cardRenderer` is defined
- `src/bot/formatting/result-card.ts`, `result-card.test.ts` — **deleted**
- `src/bot/formatting/correction-copy.ts`, `correction-card.ts` — historical
  contrast mentions of `result-card.ts` kept, each first mention marked
  "(retired in 04-12)"
- `src/bot/entry-point-reachability.test.ts` (new) — 3 tests: voice success
  (defined replyMarkup, every button parses to the persisted draftId, a
  confirm action exists), text success (identical keyboard, not a second
  path), D-08 (Phase 3) negative control (noFood, no replyMarkup)
- `.planning/phases/04-confirm-correct-diary-persistence/04-VALIDATION.md` —
  three new rows (04-12 T1/T2/T3), all green; a line recording CORRECT-07/
  CALC-02 as still undischarged

## Decisions Made

See `key-decisions` in frontmatter. In short: the renderer lives in the bot
layer and is injected via `deps` (grammY stays out of `src/application/`);
`result-card.ts` was deleted outright rather than kept as an orphan; the
`isWeakMatch` invariant comment now points at `correction-card.ts`.

## Deviations from Plan

None. All three tasks were executed exactly as specified, including the
DECISION-NUMBER WARNING's Phase 3/Phase 4 `D-08` qualification (this plan's
"D-08" references are all the Phase 3 empty-decomposition meaning, never the
Phase 4 confirmed-hard-delete meaning) and the mandatory sourcing of the
Task 3 tripwire's renderer from `buildMealHandlerDeps` rather than a direct
`createDraftCardRenderer()` import.

One clarification worth recording: the plan's `<verify>` grep gate for Task 2
(`grep -rl "result-card" src/` must return only `correction-copy.ts` and
`correction-card.ts`) initially also matched `types.ts` because the first
draft of the `isWeakMatch` comment repeat used the literal string
`result-card.ts` in prose. Reworded to describe the same fact ("the Phase 3
read-only card it superseded was retired in 04-12") without the literal
matching substring — same pattern 04-10-SUMMARY.md documents for an
analogous grep-vs-prose collision.

## Issues Encountered

None beyond the grep-vs-prose wording adjustment above, resolved inline
before committing Task 2.

## User Setup Required

None — no external service configuration, no migration, no environment
variable. This plan touches only application-layer and bot-layer TypeScript.

## Verification

- `npm test`: **680 tests, 51 files, all green** (was 687/49 before this
  plan; the count moved because `result-card.test.ts` was removed and three
  test files gained cases — `draft-card-renderer.test.ts`,
  `message-editor.test.ts`, `entry-point-reachability.test.ts` are new files;
  `voice-pipeline.test.ts` and `pipeline-wiring.test.ts` gained cases in
  place).
- `npx tsc --noEmit`: exit 0, no errors.
- `grep -rl "from '.*result-card" src/` → empty.
- `grep -rl "result-card" src/` → exactly `correction-copy.ts` and
  `correction-card.ts` (both marked "(retired in 04-12)" at first mention).
- `npx vitest run src/bot/entry-point-reachability.test.ts
  src/bot/telegram/message-editor.test.ts` → green.
- `04-VALIDATION.md`'s Per-Task Verification Map carries rows for
  04-12 T1/T2/T3, all ✅ green.

## Next Steps for the Owner

The fix is in. Restart the bot (`npm run bot`) and re-run
`docs/phase-04-manual-checklist.md` starting from scenario 1 — a voice
message describing a multi-ingredient dish should now produce the Phase 4
level-1 correction card WITH working buttons (component picks, `➕ Добавить`,
`✅ Подтвердить`), not the old buttonless Phase 3 text. Everything from
scenario 2 onward (candidate swap, ±10 г, typed grams, remove/add, confirm,
delete, restart survival, «нет данных» sugar) was built in plans 04-01..04-10
and is now reachable for the first time — please walk through the whole
checklist so CORRECT-07 and CALC-02 can finally be marked verified.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-16*

## Self-Check: PASSED

- FOUND: src/bot/telegram/draft-card-renderer.ts
- FOUND: src/bot/telegram/draft-card-renderer.test.ts
- FOUND: src/bot/telegram/message-editor.test.ts
- FOUND: src/bot/entry-point-reachability.test.ts
- MISSING (expected, deleted by design): src/bot/formatting/result-card.ts
- MISSING (expected, deleted by design): src/bot/formatting/result-card.test.ts
- FOUND commits: 279b232, 9a6a811, e7ed9be, 40d60ea
