---
phase: 02-bot-skeleton-onboarding
plan: 07
subsystem: bot-copy
tags: [onboarding, disclaimer, telegram, manual-verification]

# Dependency graph
requires:
  - phase: 02-bot-skeleton-onboarding (Plan 02, 06)
    provides: DISCLAIMER_TEXT draft, onboarding conversation, /start entry point, manual checklist document
provides:
  - Owner-approved disclaimer wording recorded in code (ONBOARD-06)
affects: [02-bot-skeleton-onboarding (Task 3 pending), future legal review before payment milestone]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/bot/formatting/onboarding-copy.ts
    - .planning/phases/02-bot-skeleton-onboarding/02-MANUAL-CHECKLIST.md

key-decisions:
  - "Owner approved DISCLAIMER_TEXT unchanged, character for character, on 2026-08-11 (approve-as-is option)"

patterns-established: []

requirements-completed: []  # ONBOARD-02, ONBOARD-05, ONBOARD-06 NOT yet complete — Task 3 (manual walkthrough) still pending, see status below.

# Metrics
duration: in progress (paused at checkpoint)
completed: null
---

# Phase 02 Plan 07: Disclaimer approval + manual checklist walkthrough (PARTIAL — paused at Task 3)

**Owner approved the ONBOARD-06 disclaimer wording unchanged on 2026-08-11; the plan is paused before the mandatory real-Telegram manual checklist walkthrough (Task 3), which only the owner can perform.**

## Status: PAUSED AT CHECKPOINT (Task 3 of 3)

This is an interim SUMMARY. Task 1 and Task 2 are complete and committed.
Task 3 (`checkpoint:human-verify`) requires the owner to run the bot and walk
`.planning/phases/02-bot-skeleton-onboarding/02-MANUAL-CHECKLIST.md` in a real
Telegram client. This cannot be done by the executing agent. **Do not consider
this plan, or Phase 2, complete until Task 3 is finished and this file is
updated with the walkthrough results and a `completed:` date.**

## Performance (partial)

- **Tasks completed:** 2 of 3 (Task 1: decision, Task 2: apply approval)
- **Files modified:** 2

## Task 1: Owner approves the disclaimer wording (checkpoint:decision) — RESOLVED

**Decision:** `approve-as-is` — the owner chose to keep the current draft
wording unchanged, character for character, on 2026-08-11.

**Approved wording (verbatim, as it appears in `DISCLAIMER_TEXT`):**

> ⚠️ Важно: VoxBite — не медицинское изделие. Расчёт целевых калорий и БЖУ
> сделан по общей формуле (Миффлина-Сан Жеора) и носит справочный характер.
> Он не учитывает заболевания, приём лекарств, беременность и другие
> индивидуальные особенности. Бот не ставит диагнозов и не назначает
> лечение. Перед тем как менять питание, посоветуйся с врачом или
> дипломированным диетологом.

The owner was told explicitly that this text was drafted by Claude, not
reviewed by a lawyer, and that a real legal review is worth doing before the
paid-subscription milestone. They accepted it knowingly for the closed beta.
No file was edited for this task, per plan instructions.

## Task 2: Apply the approved wording and re-verify — DONE

Since the wording was approved unchanged, no wording edit was made. Only the
`черновик, требует утверждения владельцем` comment above `DISCLAIMER_TEXT`
was replaced with a dated approval note:

```
// ONBOARD-06 — формулировка утверждена владельцем без изменений 2026-08-11, см. план 02-07.
```

Also updated the two draft-status notes in `02-MANUAL-CHECKLIST.md` (Section
4 note and the final sign-off block) to state the wording is approved rather
than pending.

**Verification:**
- `npx vitest run src/bot/formatting/onboarding-copy.test.ts` — 10/10 passed
- `npm test` — 304/304 passed (22 files)
- `npx tsc --noEmit` — clean
- Plan's automated verify script (checks for stray "черновик", presence of
  "утвержд" comment, and DISCLAIMER_TEXT assertion in test file) — passed

**Commit:** `9a59a69` — `feat(02-07): record owner approval of disclaimer wording`

## Task Commits

1. **Task 1: Owner approves disclaimer wording** — decision only, no commit (no file changes per plan)
2. **Task 2: Apply approved wording and re-verify** — `9a59a69` (feat)

## Decisions Made

- Owner approved the ONBOARD-06 disclaimer wording exactly as drafted, closing the STATE.md blocker "Legal/medical disclaimer copy (Phase 2, ONBOARD-06) still needs final wording from the owner" — see updated STATE.md.
- Owner was told a real legal review is advisable before the paid-subscription milestone (not before closed beta).

## Deviations from Plan

None — Task 1 and Task 2 executed exactly as written.

## Issues Encountered

None so far. Task 3 not yet attempted.

## Task 3: Owner walks the manual checklist (checkpoint:human-verify) — NOT STARTED

This is the blocking checkpoint. See the orchestrator's checkpoint return for
the Russian-language orientation given to the owner. No checklist box has
been ticked, no bot process was started by the agent, and `BETA_ALLOWLIST`
was not touched — all of that is the owner's step to perform.

**When the owner completes the walkthrough**, a follow-up agent should:
1. Verify every checkbox in `02-MANUAL-CHECKLIST.md` is ticked and a sign-off date is filled in.
2. Record the owner's per-section results in this SUMMARY (replacing this section).
3. Note any defect found as gap-closure input.
4. Update `requirements-completed` to `[ONBOARD-02, ONBOARD-05, ONBOARD-06]`, set `completed:` date and `duration:`.
5. Commit the checklist and this SUMMARY together.
6. Run the standard STATE.md / ROADMAP.md / REQUIREMENTS.md updates and final metadata commit.

## Next Phase Readiness

Not ready — Phase 2 cannot be marked complete until Task 3's manual
walkthrough is done and this SUMMARY is finalized with real results.

---
*Phase: 02-bot-skeleton-onboarding*
*Status: PAUSED — awaiting Task 3 (owner manual verification)*
