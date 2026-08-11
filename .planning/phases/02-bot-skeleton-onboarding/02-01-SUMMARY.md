---
phase: 02-bot-skeleton-onboarding
plan: 01
subsystem: infra
tags: [grammy, telegram, env-config, dotenv-safe, vitest]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: src/config/env.ts base module (DATABASE_URL, OPENAI_API_KEY), .env with those two keys already populated
provides:
  - grammY 1.45.1 + @grammyjs/conversations 2.1.1 installed as exact pins (no @grammyjs/menu)
  - "npm run bot" as the owner's single start command (tsx src/bot/index.ts, file created in a later plan)
  - loadEnv() requiring TELEGRAM_BOT_TOKEN and tolerating an empty BETA_ALLOWLIST (fail-closed first run)
  - a real Telegram bot registered via BotFather, its token filled into the owner's gitignored .env
affects: [02-02, 02-03, 02-04, 02-05, 02-06, 02-07, bot-skeleton-onboarding remaining plans]

# Tech tracking
tech-stack:
  added: [grammy@1.45.1, "@grammyjs/conversations@2.1.1"]
  patterns:
    - "REQUIRED_ENV_KEYS vs OPTIONAL_ENV_KEYS split in src/config/env.ts: optional keys must be declared in .env.example but never flow into the missingKeys check, so an intentionally empty value is a legal, tested state rather than a startup crash"

key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
    - src/config/env.ts
    - src/config/env.test.ts
    - .env.example
    - .env (owner's local file, gitignored, not committed)

key-decisions:
  - "Did not install @grammyjs/menu — Phase 2's onboarding flow is strictly linear (InlineKeyboard + conversation.waitFor), per 02-RESEARCH.md Open Question 3"
  - "BETA_ALLOWLIST kept out of REQUIRED_ENV_KEYS via a new OPTIONAL_ENV_KEYS export, so empty-on-first-run is explicit and fail-closed (D-04) instead of a crash the next dev fixes by defaulting to permissive"

patterns-established:
  - "Owner-facing checkpoint copy: plain Russian, jargon explained inline, numbered steps, a 'если что-то пошло не так' recovery section — reused from scripts/check-setup.ts's voice"

requirements-completed: [ONBOARD-01]

# Metrics
duration: 6min
completed: 2026-08-11
---

# Phase 2 Plan 1: Bot Skeleton Bootstrap Summary

**grammY + conversations plugin installed, TELEGRAM_BOT_TOKEN made a hard startup requirement with a Russian error, BETA_ALLOWLIST made legal-when-empty, and the owner's real bot token is now in a gitignored `.env`.**

## Performance

- **Duration:** 6 min (task work) + this continuation session for Task 3 verification and summary
- **Started:** 2026-08-11T21:26:14+05:00
- **Completed:** 2026-08-11T21:28:55+05:00 (Tasks 1-2); Task 3 resolved and verified same session
- **Tasks:** 3 (Task 1 auto, Task 2 TDD auto, Task 3 checkpoint:human-action)
- **Files modified:** 5 tracked (`package.json`, `package-lock.json`, `src/config/env.ts`, `src/config/env.test.ts`, `.env.example`) + 1 untracked/gitignored (`.env`)

## Accomplishments

- grammY 1.45.1 and `@grammyjs/conversations` 2.1.1 installed as exact pins in `dependencies`; `@grammyjs/menu` deliberately absent
- `npm run bot` registered (`tsx src/bot/index.ts`) — the file itself is created in a later plan, so `npm run bot` currently fails with "file not found", which is expected
- `src/config/env.ts` extended: `REQUIRED_ENV_KEYS` gains `TELEGRAM_BOT_TOKEN`; new `OPTIONAL_ENV_KEYS = ['BETA_ALLOWLIST']` never flows into the missing-keys check
- `.env.example` documents both new variables, including a Russian two-step first-run discovery flow for `BETA_ALLOWLIST`
- Owner created a real bot via @BotFather and filled `TELEGRAM_BOT_TOKEN` into their local `.env`; `BETA_ALLOWLIST` deliberately left empty (fail-closed first-run state per D-04/D-06)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install grammY + conversations plugin, add `npm run bot` script** - `dd78070` (feat) — `npm outdated grammy @grammyjs/conversations` reported both packages already at their latest published versions, no drift from the pinned 1.45.1 / 2.1.1
2. **Task 2 (TDD): Extend env.ts with TELEGRAM_BOT_TOKEN + BETA_ALLOWLIST** - `92a5b32` (test, RED) → `562d245` (feat, GREEN)
3. **Task 3: Owner creates bot in BotFather, fills token into `.env`** - no commit (checkpoint:human-action; `.env` is gitignored by design and is never committed — verified via `git check-ignore -q .env`)

**Plan metadata:** committed together with this SUMMARY (see final commit)

_Note: TDD tasks may have multiple commits (test → feat → refactor). No refactor commit was needed here._

## Files Created/Modified

- `package.json` / `package-lock.json` - grammY + conversations plugin pinned deps, `bot` script added
- `src/config/env.ts` - `TELEGRAM_BOT_TOKEN` added to `REQUIRED_ENV_KEYS`; new `OPTIONAL_ENV_KEYS` export for `BETA_ALLOWLIST`; `AppEnv` and `cachedEnv` extended
- `src/config/env.test.ts` - three new cases: token-missing throws naming `TELEGRAM_BOT_TOKEN`; allowlist absent yields `''`; allowlist set to `''` yields `''`; sync assertion now covers both key lists
- `.env.example` - `TELEGRAM_BOT_TOKEN` and `BETA_ALLOWLIST` blocks in the established three-part comment shape, Russian first-run guidance for the empty allowlist
- `.env` (owner's local file, untracked/gitignored) - real `TELEGRAM_BOT_TOKEN` from BotFather filled in; `BETA_ALLOWLIST=` left intentionally empty

## Decisions Made

- Confirmed `@grammyjs/menu` stays out of the dependency tree for the whole phase (linear onboarding flow, per 02-RESEARCH.md)
- Confirmed the `REQUIRED_ENV_KEYS` / `OPTIONAL_ENV_KEYS` split as the mechanism for "declared but legally empty" config, rather than special-casing `BETA_ALLOWLIST` inside `missingKeys`

## Deviations from Plan

None - plan executed exactly as written across all three tasks.

## Issues Encountered

None. The Task 3 checkpoint (owner creating the bot via @BotFather and filling the token into `.env`) resolved on the first attempt — the owner confirmed with "готово". Automated verification confirmed:
- `.env` exists with a `TELEGRAM_BOT_TOKEN=` line matching the BotFather token shape (`^[0-9]+:[A-Za-z0-9_-]{20,}$`)
- `.env` contains a `BETA_ALLOWLIST=` line, intentionally empty (this is the correct fail-closed first-run state, not an error)
- `git check-ignore -q .env` exits 0 — `.env` is gitignored and does not appear in `git status --short`
- Full suite green: `npx tsc --noEmit` clean, `npm test` — 255 tests passed across 17 files, no regression
- The token value itself was never printed, logged, or written to any tracked file, commit message, or this SUMMARY

## User Setup Required

None further for this plan — the owner has already completed the one manual step this plan required (creating the bot via @BotFather and filling `.env`). `DATABASE_URL` and `OPENAI_API_KEY` remain untouched from Phase 1.

## Next Phase Readiness

- `TELEGRAM_BOT_TOKEN` and `BETA_ALLOWLIST` are both available and correctly typed via `loadEnv()` for every subsequent Phase 2 plan
- `npm run bot` exists as the entrypoint script; `src/bot/index.ts` itself (created in a later plan in this phase) is the next blocking piece before the bot can actually run
- The allowlist is deliberately empty — Plan 06 (per D-06) is where the owner's own Telegram ID gets discovered via a refusal message and added

---

*Phase: 02-bot-skeleton-onboarding*
*Completed: 2026-08-11*

## Self-Check: PASSED

All referenced files (`src/config/env.ts`, `.env.example`, this SUMMARY) and all referenced commit hashes (`dd78070`, `92a5b32`, `562d245`, `ac0c472`) verified present.
