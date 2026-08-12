---
phase: 02-bot-skeleton-onboarding
verified: 2026-08-12T11:05:00Z
status: human_needed
score: 4/4 must-haves verified (code-level); owner walkthrough attestation was blanket, not per-item
overrides_applied: 0
human_verification:
  - test: "Run /start on the real bot, complete all 7 questions (sex, age, height, weight, activity, goal, rate if applicable, timezone) with a mix of button taps and typed numbers, confirm targets, then run /start again."
    expected: "Onboarding completes, targets + disclaimer shown before confirmation, second /start shows stored targets + disclaimer with a 'redo' button, no crash or silent hang."
    why_human: "The only prior attestation was a single blanket 'Все прошло без ошибок' with no per-step transcript (per orchestrator note); code-level evidence is strong but an independent live run has not been recorded against the current commit (0c3a72d), which is 4 commits ahead of the original walkthrough."
---

# Phase 2: Bot skeleton + onboarding Verification Report

**Phase Goal:** Users can complete onboarding through the real Telegram bot and see their calculated КБЖУ targets, validating the webhook/bot-framework plumbing before the AI pipeline is layered on top.
**Verified:** 2026-08-12T11:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification (a prior run was cut off before writing anything)

## Note on prior "manual walkthrough" evidence

Per the orchestrator's execution history, the 02-07 owner sign-off was a
single blanket "Все прошло без ошибок" (no per-item transcript), and the code
review's 3 blockers were found and fixed *after* that sign-off (commits
`7598cbd`, `c766506`, `2088b2f`, `4980eb4`, `0c3a72d` — the last four are all
dated 2026-08-12, one day after the review). The manual checklist's boxes are
therefore attestation of an earlier, now-superseded code state, not evidence
against the code currently in the repo. This report verifies the current code
directly and does not treat the checklist as proof.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can run `/start` and complete onboarding (sex, age, height, weight, activity, goal, timezone) via inline buttons + text input | ✓ VERIFIED (code) | `src/bot/conversations/onboarding.ts:277-304` walks all 7 fields; `askOption` (buttons) used for sex/activity/goal/timezone, `askNumber` (text) for age/height/weight. `createStartHandler` (`src/bot/commands/start.ts:62-79`) enters the conversation for new/incomplete users. `bot.ts` registers allowlist → session → conversations → conversation → handlers in the load-bearing order (`bot.wiring.test.ts` per SUMMARY, not independently re-run here but consistent with source). Timezone reaches persistence via `answers.timezone` read directly in `save-user.ts:59` (bypassing `assembleProfile`, which deliberately excludes it from `NutritionProfile` — confirmed by reading both files, resolving the orchestrator's flagged ambiguity). |
| 2 | Weight-gain/loss rate capped at 1 kg/month by the UI itself, not only the formula | ✓ VERIFIED (code) | `src/bot/onboarding/rate-presets.ts`: `RATE_PRESETS_KG_PER_MONTH = [0.25, 0.5, 0.75, 1]` — the top preset is the cap, so a value above it is not renderable as a button. `decodeRate` only accepts exact string matches against this list (no float parsing of arbitrary callback data). `askRate` (`onboarding.ts:202-214`) additionally re-checks membership before accepting. DB-level backstop confirmed live: `verify-schema.ts` output shows "CHECK-ограничения на users — 4 ограничений... потолок темпа набора/снижения веса (1 кг/месяц)" against the actual Supabase instance. |
| 3 | User sees calculated targets and can confirm or restart onboarding | ✓ VERIFIED (code) | `targetsWithDisclaimerMessage` renders kcal/macros; confirm screen offers `CONFIRM_CALLBACK`/`RESTART_CALLBACK` via `buildConfirmKeyboard()` (`onboarding.ts:328-348`). Restart re-enters the outer `for(;;)` loop without writing (`answers.restarting` message, line 380) — confirmed no write occurs before that branch. Confirm path saves via idempotent upsert (`save-user.ts` `onConflictDoUpdate`) and on failure re-shows the confirm screen with answers intact (CR-01 fix, `onboarding.ts:358-376`) rather than losing progress. |
| 4 | Non-medical-device disclaimer shown during onboarding, before targets confirmed | ✓ VERIFIED (code) | `DISCLAIMER_TEXT` (`onboarding-copy.ts:16-22`) is appended inside `targetsWithDisclaimerMessage`, which is the only string shown at the confirm step (`onboarding.ts:316`, sent before the confirm keyboard is offered — i.e. before any confirmation is possible). WR-02 gap (disclaimer missing on the returning-user `/start` path) was found by code review and is now fixed: `buildExistingTargetsMessage` in `start.ts:50-60` appends the same `DISCLAIMER_TEXT` constant (not a second variant). Both paths are test-guarded: `start.test.ts:80-87` and `:123-124` assert `DISCLAIMER_TEXT` is present and ordered after the numbers. |

**Score:** 4/4 truths verified at the code level.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/bot/bot.ts` | Composition root, correct middleware order | ✓ VERIFIED | Allowlist → session (`sess:` prefix) → conversations (`conv:` prefix) → conversation → handlers → `bot.catch`. Comment + code agree; namespacing prevents the `bot_sessions` row-collision bug fixed earlier in the phase. |
| `src/bot/conversations/onboarding.ts` | 7-step flow + confirm/restart + disclaimer + cancel path | ✓ VERIFIED | All 3 code-review blockers (CR-01/02/03) visibly fixed in this file: `cancelIfRequested`/`conversation.halt()`, `ack()` wrapping every `answerCallbackQuery`, `conversation.external()`-wrapped save with failure recovery. |
| `src/bot/commands/start.ts` | Branch new vs. returning user, disclaimer on both paths | ✓ VERIFIED | `isFullyOnboarded` guard; `buildExistingTargetsMessage` includes `DISCLAIMER_TEXT` (WR-02 fix). |
| `src/bot/onboarding/rate-presets.ts` | Hard 1 kg/month ceiling at UI layer | ✓ VERIFIED | Literal `[0.25, 0.5, 0.75, 1]`, allowlist-only decode. |
| `src/bot/onboarding/save-user.ts` | Idempotent upsert incl. timezone | ✓ VERIFIED | `onConflictDoUpdate` on `telegramId`; persists `answers.timezone` and `targets.rateKgPerMonth` (not raw requested rate). |
| `src/db/schema/bot-sessions.ts` + migrations | `bot_sessions` table, RLS enabled | ✓ VERIFIED (live DB) | `verify-schema.ts` run against the actual Supabase instance in this session confirms table exists, RLS enabled, 5 migrations applied. |
| `src/bot/formatting/onboarding-copy.ts` | Owner-approved disclaimer string, cancel copy | ✓ VERIFIED | `DISCLAIMER_TEXT` dated/approved 2026-08-11 per comment; `CANCEL_KEYWORDS`/`cancelHint` present (CR-03). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `bot.ts` `/start` handler | `onboarding.ts` conversation | `ctx.conversation.enter(ONBOARDING_CONVERSATION_ID)` | ✓ WIRED | Both new-user path (`start.ts:78`) and restart-button path (`bot.ts:108`) enter the same conversation id. |
| `onboarding.ts` confirm step | `save-user.ts` | `conversation.external(() => saveOnboardedUser(...))` | ✓ WIRED | Wrapped for replay-safety; failure path re-prompts instead of losing state. |
| `rate-presets.ts` cap | `users_desired_rate_check` DB constraint | UI cap + domain clamp + DB CHECK | ✓ WIRED (3 layers) | Confirmed live via `verify-schema.ts` CHECK-constraint output. |
| `onboarding-copy.ts` `DISCLAIMER_TEXT` | `start.ts` + `onboarding.ts` | direct import, single constant, no duplicate string | ✓ WIRED | Both call sites import the same constant; regression tests assert presence in both messages. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Bot module tests (skeleton + onboarding) | `npx vitest run src/bot` | 14 files, 179 tests passed | ✓ PASS |
| Live schema check (bot_sessions, RLS, rate CHECK) | `npx tsx scripts/verify-schema.ts` | `SCHEMA OK`, all checks `[ok]` | ✓ PASS |
| Debt-marker scan on phase files | `grep -rn "TBD\|FIXME\|XXX" src/bot/` | no matches | ✓ PASS |
| Full bot boot / live Telegram round-trip | — | not run (owner has a live process; a second instance would 409-conflict) | ? SKIP — routed to human verification below |

Note: orchestrator-reported full-suite results (`npx tsc --noEmit` clean, `npm test` 351/351) were trusted per instructions and not re-run in full; the `src/bot` subset (179 tests) was re-run directly in this session as a targeted check.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| ONBOARD-01 | 02-01, 02-03, 02-04, 02-05, 02-06 | Onboarding collects sex/age/height/weight/activity/goal/timezone | ✓ SATISFIED | 7-step conversation, timezone persisted (see truth #1). |
| ONBOARD-02 | 02-02, 02-05, 02-07 | Desired rate capped at 1 kg/month | ✓ SATISFIED | 3-layer cap, live-DB CHECK constraint confirmed. |
| ONBOARD-05 | 02-03, 02-06, 02-07 | User sees targets, can confirm or redo | ✓ SATISFIED | Confirm/restart keyboard + idempotent save-or-retry. |
| ONBOARD-06 | 02-02, 02-07 | Non-medical-device disclaimer during onboarding | ✓ SATISFIED | Present on confirm screen and (after WR-02 fix) on returning-user `/start`; both test-guarded. |

No orphaned requirements found for Phase 2 in REQUIREMENTS.md.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/bot/formatting/onboarding-copy.ts` / `target-calories.ts` | WR-03 (deferred) | Displayed/persisted rate can be wrong when the calorie floor overrides the requested rate | ⚠️ Warning (deferred by owner) | Does not violate the 1 kg/month cap (still ≤ cap) but shows the user a number the plan doesn't actually use. Does not block any of the 4 success criteria — informational debt, correctly left open per owner's explicit deferral decision. |
| `src/bot/middleware/allowlist.ts` | WR-01 (deferred) | `.map(Number)` admits hex/exponent notation in `BETA_ALLOWLIST` | ⚠️ Warning (deferred by owner) | Security-adjacent but does not affect onboarding-goal criteria; owner accepted this risk explicitly, out of scope for this phase's goal. |
| Various | WR-04–WR-15, IN-01–IN-08 (deferred) | 14 warnings + 8 info, per 02-REVIEW.md "Fixes applied" section | ℹ️ Info | All explicitly and deliberately deferred by the owner on 2026-08-12; documented as accepted, not phase-blocking. |
| `onboarding.ts` | 24h `maxMillisecondsToWait` timeout | Silent halt with no user-facing message when a conversation times out | ℹ️ Info | Documented, deliberate, out of fix scope per orchestrator note. Does not affect any of the 4 success criteria (a user actively completing onboarding never hits this path); only matters for someone who abandons onboarding for >24h, who was already stuck before this phase's fixes and is now merely un-stuck-without-notification rather than permanently trapped (net improvement over pre-CR-03 state). |

No debt markers (TBD/FIXME/XXX) found in phase-touched files — gate passes clean.

### Human Verification Required

### 1. Live end-to-end onboarding walkthrough on current code

**Test:** On the real Telegram bot (owner's running instance), execute `/start` as a fresh or reset test account, answer all 7 fields with a mix of button taps (sex, activity, goal, rate if gain/loss, timezone) and typed numbers (age, height, weight), reach the confirm screen, tap "Всё верно", then send `/start` again as the now-onboarded user.

**Expected:** Each question is asked in order; typed answers below/above plausibility bounds are rejected with a Russian re-prompt; the rate keyboard shows exactly 4 options none exceeding 1 kg/month; the confirm screen shows calories/macros plus the disclaimer *before* any tap; confirming saves without error; the second `/start` shows the same stored targets plus the disclaimer and a "Пройти анкету заново" button, without re-asking questions or wiping the profile.

**Why human:** This is the load-bearing acceptance test for the phase goal, and the only prior evidence (02-MANUAL-CHECKLIST.md) is dated 2026-08-11 with per-item boxes ticked, but the actual owner narrative was one blanket confirmation, and 4 fix commits (including the CR-01/02/03 blockers and the WR-02 disclaimer gap) landed on 2026-08-12 — after that checklist run. The current code has not been independently confirmed to behave correctly end-to-end via a live Telegram client since those fixes landed. Code-level tracing (this report) is thorough but cannot substitute for an actual client round-trip (button rendering, callback timing, Telegram-side quirks).

### Gaps Summary

No gaps found at the code level — all 4 ROADMAP success criteria are backed
by source code that does what it claims, all 3 code-review blockers plus
WR-02 have visible, tested fixes, and the live database independently
confirms the schema/RLS/CHECK-constraint claims. The only reason this report
is not `passed` is that the single piece of human-observed evidence (the
manual walkthrough) predates the most recent fix commits and was not a
per-item transcript to begin with — per this agent's mandate to not treat
that attestation as proof for the current commit. Recommend a short live
re-walkthrough (see Human Verification above) before treating Phase 2 as
fully closed; this is a confirmation step, not a rework — no code changes are
expected as a result of a clean run.

The 22 deliberately-deferred review findings (WR-01, WR-03–WR-15, IN-01–IN-08)
remain open technical debt by the owner's explicit choice and do not block
this phase's goal.

---

_Verified: 2026-08-12T11:05:00Z_
_Verifier: Claude (gsd-verifier)_
