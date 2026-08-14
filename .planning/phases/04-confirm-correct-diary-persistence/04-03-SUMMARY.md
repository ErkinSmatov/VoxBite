---
phase: 04-confirm-correct-diary-persistence
plan: 03
subsystem: bot
tags: [grammy, telegram, i18n, error-handling, vitest]

# Dependency graph
requires:
  - phase: 02-onboarding-safety-nets
    provides: ack.ts's swallow-one-specific-error pattern and pipeline-copy.ts's as-const copy-module shape, both copied verbatim here
  - phase: 03-voice-pipeline
    provides: result-card.ts's noMatch wording ("не нашёл подходящую запись"), reused verbatim in correctionCopy so pre- and post-confirm cards never disagree
provides:
  - safeEditMessageText / safeEditMessageReplyMarkup — idempotent card/keyboard redraw helpers that swallow only Telegram's "message is not modified" 400
  - correctionCopy — every Russian string and button label for the D-01..D-12 correction flow, in one reviewable as-const module
affects: [04-06, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "safe-edit wrapper: catch, instanceof GrammyError + description substring match, swallow only that one case, rethrow everything else unchanged — same shape as ack.ts, now the second instance of this pattern in src/bot/telegram/"
    - "correction-copy.ts: same as-const copy-module shape as pipeline-copy.ts/onboarding-copy.ts, one doc comment per key naming its decision id, zero grammy imports"

key-files:
  created:
    - src/bot/telegram/safe-edit.ts
    - src/bot/telegram/safe-edit.test.ts
    - src/bot/formatting/correction-copy.ts
    - src/bot/formatting/correction-copy.test.ts
  modified: []

key-decisions:
  - "notYours is byte-identical to expired (both 'Этот разбор устарел, отправь сообщение заново.') so a tapping user cannot distinguish a nonexistent draft id from one belonging to another user (T-04-17)"
  - "chosenMarker uses a plain checkmark '✓' — no decision id specified an exact glyph, chosen to match the repo's existing emoji-as-status-marker convention (e.g. onboarding-copy's disclaimer emoji) without introducing Markdown-hazard characters"

requirements-completed: [CORRECT-01, CORRECT-05]

duration: 25min
completed: 2026-08-14
---

# Phase 04 Plan 03: Safe Redraw Helper + Correction Copy Module Summary

**safeEditMessageText/safeEditMessageReplyMarkup swallow only Telegram's "message is not modified" 400, and correctionCopy centralizes every Russian string (button labels, card fragments, flow messages) for the whole confirm/correct/save loop with an IDOR-safe notYours===expired invariant.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-14T18:51:00Z
- **Completed:** 2026-08-14T19:16:04Z
- **Tasks:** 2 completed
- **Files modified:** 4 (all new)

## Accomplishments
- `safeEditMessageText` / `safeEditMessageReplyMarkup` built with narrow, tested error swallowing — only `GrammyError` carrying `'message is not modified'` is caught; `message to edit not found` and any non-GrammyError error still propagate to `bot.catch()` (verified with a real `GrammyError` construction, not a string-only fake, so the `instanceof` narrowing is genuinely load-bearing)
- `correctionCopy` created with all 30 required keys/functions covering D-01 through D-12, zero grammY imports, no Markdown hazard characters anywhere (asserted across every string and every function's sample output)
- Full TDD RED/GREEN cycle run for Task 1 (test file authored and confirmed failing against a temporarily-removed implementation, then confirmed passing once restored)

## Task Commits

Each task was committed atomically:

1. **Task 1: safeEditMessageText / safeEditMessageReplyMarkup**
   - `c5ba90b` (test) — RED: failing test importing the not-yet-created module
   - `147da8a` (feat) — GREEN: implementation, all 9 assertions pass
2. **Task 2: correctionCopy — every Russian string for the correction flow** - `2593086` (feat)

**Plan metadata:** committed separately after this summary is written.

## Files Created/Modified
- `src/bot/telegram/safe-edit.ts` - `safeEditMessageText`/`safeEditMessageReplyMarkup`, structurally-typed ctx params, swallow only the "message is not modified" GrammyError
- `src/bot/telegram/safe-edit.test.ts` - 9 assertions covering success, swallowed error, rethrown GrammyError, and rethrown plain Error for both helpers
- `src/bot/formatting/correction-copy.ts` - `correctionCopy as const`, all D-01..D-12 button labels, card fragments, and flow messages
- `src/bot/formatting/correction-copy.test.ts` - 8 test cases asserting key existence, `partialTotal`/`blockedConfirm` behavior, `notYours === expired`, and no Markdown-hazard characters

## Decisions Made
- `notYours` is byte-identical to `expired` (T-04-17 mitigation) — documented above and asserted by a dedicated test.
- `chosenMarker` set to `'✓'` — no glyph was specified in the plan; chosen for consistency with the repo's existing status-marker conventions and to stay free of Markdown-hazard characters.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 06, 09, and 10 can now import `safeEditMessageText`/`safeEditMessageReplyMarkup` and `correctionCopy` directly instead of inventing ad hoc try/catch or inline Russian strings.
- `npx vitest run src/bot/telegram src/bot/formatting` (6 files, 76 tests) and full `npm test` (41 files, 527 tests) both pass; `npx tsc --noEmit` exits 0.
- No blockers for downstream Phase 4 plans.

## TDD Gate Compliance

Task 1 (`tdd="true"`): `test(04-03): ...` commit `c5ba90b` precedes `feat(04-03): ...` commit `147da8a` — RED then GREEN gate sequence satisfied. No REFACTOR commit was needed (implementation required no cleanup after GREEN).

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-14*

## Self-Check: PASSED

All 4 created files confirmed present on disk; all 3 task commits (`c5ba90b`, `147da8a`, `2593086`) confirmed present in `git log`.
