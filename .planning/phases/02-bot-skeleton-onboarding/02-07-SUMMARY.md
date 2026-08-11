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

## Deviations / Fixes (gap fix, post-checkpoint)

**This is exactly the kind of defect Task 3's manual checklist exists to
catch — and it did.** During the owner's real walkthrough of Task 3, sending
`/start` produced `Ошибка обработчика: Error in middleware: Unknown data
format, cannot parse version` instead of the onboarding greeting. This is
recorded as evidence the checklist earns its keep: an automated test suite
that only exercises adapters in isolation would not have caught a cross-
subsystem key collision that only manifests when both `session()` and
`conversations()` run against the same live chat.

**Root cause:** `src/bot/bot.ts` wired both grammY's `session()` middleware
and `@grammyjs/conversations`' `conversations()` plugin to two *separate
instances* of `createPgStorageAdapter(deps.db)`, both backed by the same
`bot_sessions` table. grammY's `defaultGetSessionKey` and the conversations
plugin's `defaultStorageKey` both default to `ctx.chatId?.toString()` — in a
private chat these are the identical string, so both subsystems read and
wrote the *same row*. `session()` ran first and wrote its plain initial
value `{}`. `conversations()` then read that same row expecting its own
versioned envelope (`{ version: [...] }`) and its `unpack()` threw `Unknown
data format, cannot parse version`. Confirmed live in the database: the
single `bot_sessions` row for the owner's chat held `value={}` with no
`version` field (the row's `key` was the owner's numeric Telegram chat ID —
not reproduced here per this project's rule against committing the owner's
Telegram ID into files).

**Fix:** `createPgStorageAdapter(db, keyPrefix)` in
`src/bot/storage/pg-storage-adapter.ts` now accepts an optional key prefix,
applied inside `read`/`write`/`delete` before touching the table. `bot.ts`
now passes `'sess:'` to the session adapter and `'conv:'` to the
conversations adapter, so the two subsystems get disjoint key namespaces
within the same table even for an identical raw chat-ID key. Middleware
registration order (allowlist → session → conversations → conversation →
commands, decision D-05) and the stored value's opacity were both left
unchanged — the fix is purely inside the adapter factory and its two call
sites.

**Regression test:** added
`src/bot/storage/pg-storage-adapter.test.ts` — *"two adapters with different
keyPrefix values do not observe each other's writes for the same logical
key"*. It builds a `'sess:'`-prefixed adapter and a `'conv:'`-prefixed
adapter over one fake in-memory table, writes a session-shaped value under
a shared raw chat-ID-shaped key, asserts the conversation adapter reads
`undefined` (not the session's value) for that same raw key, then writes
and re-reads both independently to confirm the underlying fake table ends
up with two distinct rows (`sess:<key>`, `conv:<key>`) rather than one
shared row. This test fails against the pre-fix adapter (no `keyPrefix`
parameter, same raw key used by both).

**Stale row cleanup:** the live `bot_sessions` row for the owner's chat
(`value={}`) is now orphaned — no consumer looks up an unprefixed key
anymore. It contained no user data (an empty session object), so it was
deleted via a one-off script (`npx tsx`, not a migration, not committed —
the script was written to a temp path, run once directly against the live
database, and removed immediately after). No other rows were touched.

**Verification run after the fix:**
- `npx tsc --noEmit` — clean
- `npm test` — 305/305 passed (22 files; +1 test from the regression case)
- Plan 02-06's registration-order static check (re-run verbatim from its
  `<automated>` verify block) — `start wiring OK`
- The bot process was **not** started, per instruction, to leave the
  owner's Telegram long-polling connection uncontested.

**Commit:** `4c739e2` — `fix(02): namespace session/conversation storage keys to stop bot_sessions collision`

---
*Phase: 02-bot-skeleton-onboarding*
*Status: PAUSED — awaiting Task 3 (owner manual verification); this gap fix unblocks the owner to retry `/start`*
