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
  - Owner-signed-off manual verification of all four Phase 2 ROADMAP success criteria
  - Storage-key-collision fix (session()/conversations() no longer share bot_sessions rows)
affects: [Phase 2 complete, future legal review before payment milestone]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createPgStorageAdapter(db, keyPrefix) namespaces grammY session() and @grammyjs/conversations storage inside one shared bot_sessions table"

key-files:
  created:
    - src/bot/storage/pg-storage-adapter.test.ts (regression test for the keyPrefix collision fix, added mid-checkpoint)
  modified:
    - src/bot/formatting/onboarding-copy.ts
    - .planning/phases/02-bot-skeleton-onboarding/02-MANUAL-CHECKLIST.md
    - src/bot/storage/pg-storage-adapter.ts (keyPrefix param, added mid-checkpoint)
    - src/bot/bot.ts ('sess:'/'conv:' prefixes, added mid-checkpoint)

key-decisions:
  - "Owner approved DISCLAIMER_TEXT unchanged, character for character, on 2026-08-11 (approve-as-is option)"
  - "Owner's Task 3 sign-off was a single blanket confirmation ('Все прошло без ошибок'), not a recorded per-item transcript — documented explicitly rather than presented as if each of the 29 items was individually reported"

patterns-established:
  - "Any grammY plugin backed by the shared bot_sessions table via createPgStorageAdapter must pass a distinct keyPrefix — two plugins defaulting their storage key to ctx.chatId collide silently"

requirements-completed: [ONBOARD-02, ONBOARD-05, ONBOARD-06]

# Metrics
duration: same-day (spanned a checkpoint pause for owner walkthrough)
completed: 2026-08-11
---

# Phase 02 Plan 07: Disclaimer approval + manual checklist walkthrough Summary

**Owner approved the ONBOARD-06 disclaimer wording unchanged on 2026-08-11, then walked the full manual checklist in a real Telegram client, hit and confirmed the fix for a real storage-key-collision bug in Section 1, and gave a final blanket "Все прошло без ошибок" — closing Phase 2's last two open items.**

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

## Mid-checkpoint bug fix: storage-key collision (found by the walkthrough)

**This is exactly the kind of defect the manual checklist exists to catch —
and it did.** During the owner's first real walkthrough of Task 3, sending
`/start` produced `Ошибка обработчика: Error in middleware: Unknown data
format, cannot parse version` instead of the onboarding greeting. No unit
test caught this — it only manifests when `session()` and `conversations()`
run against the same live chat.

**Root cause:** `src/bot/bot.ts` wired both grammY's `session()` middleware
and `@grammyjs/conversations`' `conversations()` plugin to two *separate
instances* of `createPgStorageAdapter(deps.db)`, both backed by the same
`bot_sessions` table. grammY's `defaultGetSessionKey` and the conversations
plugin's `defaultStorageKey` both default to `ctx.chatId?.toString()` — in a
private chat these are identical strings, so both subsystems read and wrote
the same row. `session()` ran first and wrote its plain initial value `{}`.
`conversations()` then read that same row expecting its own versioned
envelope (`{ version: [...] }`) and its `unpack()` threw `Unknown data
format, cannot parse version`.

**Fix:** `createPgStorageAdapter(db, keyPrefix)` now accepts an optional key
prefix, applied inside `read`/`write`/`delete` before touching the table.
`bot.ts` now passes `'sess:'` to the session adapter and `'conv:'` to the
conversations adapter, so the two subsystems get disjoint key namespaces
within the same table even for an identical raw chat-ID key. Middleware
registration order and the stored value's opacity were left unchanged.

**Regression test:** `src/bot/storage/pg-storage-adapter.test.ts` — asserts
a `'sess:'`-prefixed adapter and a `'conv:'`-prefixed adapter over one fake
table do not observe each other's writes for the same logical key, and end
up as two distinct rows rather than one shared row. Fails against the
pre-fix adapter.

**Stale row cleanup:** the live `bot_sessions` row for the owner's chat
(`value={}`, no user data) was orphaned by the fix and deleted via a one-off
script run once directly against the live database and removed immediately
after (not committed, not a migration).

**Verification after the fix:** `npx tsc --noEmit` clean, `npm test`
305/305 passed. The bot process was not started by the agent, per
instruction, to leave the owner's Telegram long-polling connection
uncontested.

**Commits:** `4c739e2` (fix), `36bada6` (docs: record commit hash).

## Task 3: Owner walks the manual checklist (checkpoint:human-verify) — RESOLVED

The owner ran the bot in a real Telegram client, walked
`02-MANUAL-CHECKLIST.md`, hit the Section 1 failure above, waited for the
fix, restarted the bot, and re-ran the walkthrough. Their final report,
verbatim: **"Все прошло без ошибок"** (2026-08-11).

**Honesty note on the form of this confirmation:** the owner gave one
blanket confirmation after completing the checklist, not a section-by-
section transcript. All 29 checkboxes in `02-MANUAL-CHECKLIST.md` are ticked
and the sign-off block is dated 2026-08-11, but the sign-off block itself
states plainly that this reflects a single overall attestation rather than
29 individually reported results. No specific per-section observation,
screenshot, or message text beyond what is documented above (the Section 1
error and its fix) was reported by the owner and none is fabricated here.

**What is factually known, not inferred:**
- Section 1 (`/start` walks all 7 fields) initially failed with `Unknown
  data format, cannot parse version`, was fixed in `4c739e2`, and the owner
  re-ran the full walkthrough afterward.
- The owner's final word after that re-run was "Все прошло без ошибок",
  which is being treated as sign-off on all four ROADMAP success criteria
  (7-question flow, ≤1 kg/month rate cap, confirm/Изменить + persisted
  targets, disclaimer visible before confirmation) and the three resilience
  scenarios (409 two-terminal conflict, mid-conversation restart continuity,
  no-internet handling) described in the checklist.

**Commit:** `c33cd65` — `docs(02-07): sign off manual checklist after owner walkthrough`

## Task Commits

1. **Task 1: Owner approves disclaimer wording** — decision only, no commit (no file changes per plan)
2. **Task 2: Apply approved wording and re-verify** — `9a59a69` (feat)
3. **Mid-checkpoint bug fix** — `4c739e2` (fix), `36bada6` (docs)
4. **Task 3: Sign off manual checklist** — `c33cd65` (docs)

## Decisions Made

- Owner approved the ONBOARD-06 disclaimer wording exactly as drafted, closing the STATE.md blocker "Legal/medical disclaimer copy (Phase 2, ONBOARD-06) still needs final wording from the owner".
- Owner was told a real legal review is advisable before the paid-subscription milestone (not before closed beta).
- The Section 1 failure is retained in the record as evidence the manual checklist earns its place — no automated test in the 305-test suite caught it.

## Deviations from Plan

**1. [Rule 1 - Bug] Fixed session()/conversations() storage-key collision**
- **Found during:** Task 3 (owner's live walkthrough of Section 1)
- **Issue:** both grammY plugins defaulted to the same `ctx.chatId` storage key over the shared `bot_sessions` table, causing `conversations()` to fail unpacking `session()`'s plain value
- **Fix:** added an optional `keyPrefix` to `createPgStorageAdapter`; `bot.ts` now passes disjoint `'sess:'`/`'conv:'` prefixes
- **Files modified:** `src/bot/storage/pg-storage-adapter.ts`, `src/bot/bot.ts`, `src/bot/storage/pg-storage-adapter.test.ts` (new)
- **Commit:** `4c739e2`, `36bada6`

Otherwise — Task 1 and Task 2 executed exactly as written.

## Issues Encountered

The Section 1 storage-key collision above was the only issue. It was found,
fixed, regression-tested, and confirmed resolved by the owner's re-run —
no other defects were reported.

## Self-Check: PASSED

- `.planning/phases/02-bot-skeleton-onboarding/02-MANUAL-CHECKLIST.md` — FOUND, 29/29 boxes ticked, sign-off dated 2026-08-11
- Commit `9a59a69` — FOUND in git log
- Commit `4c739e2` — FOUND in git log
- Commit `36bada6` — FOUND in git log
- Commit `c33cd65` — FOUND in git log
- `npx tsc --noEmit` — clean
- `npm test` — 305/305 passed

## Next Phase Readiness

Phase 2 (bot-skeleton-onboarding) is complete. All four ROADMAP success
criteria and the three resilience scenarios have owner sign-off in a real
Telegram client, the ONBOARD-06 disclaimer is the owner's approved wording
with a guarding test, and the storage-key-collision bug found during
verification is fixed with a regression test. Phase 3 (voice pipeline) can
begin.

---
*Phase: 02-bot-skeleton-onboarding*
*Status: COMPLETE*
