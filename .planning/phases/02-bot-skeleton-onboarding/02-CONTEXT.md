# Phase 2: Bot skeleton + onboarding - Context

**Gathered:** 2026-08-11
**Status:** Ready for planning

<domain>
## Phase Boundary

The first real Telegram-facing code in the project: a grammY bot entrypoint,
the `/start` command, and a single multi-step onboarding conversation that
collects seven profile fields (sex, age, height, weight, activity level,
goal, timezone), persists them to the existing `users` table, calls the
Phase 1 nutrition domain to compute target calories/macros, and shows a
confirmation screen carrying a non-medical-device disclaimer.

Covers ONBOARD-01, ONBOARD-02, ONBOARD-05, ONBOARD-06.

**Explicitly NOT in this phase:** voice/text meal input, STT, LLM
decomposition, FDC matching at runtime, diary writes, diary views, payments,
reminders, deployment to a hosting provider.

</domain>

<decisions>
## Implementation Decisions

### Run mode & hosting
- **D-01:** The bot runs via **grammY long polling on the owner's machine**
  (`npm run bot`), not a deployed webhook. Rationale: the owner has no
  backend/deploy experience, and Phase 2 contains nothing that needs to be
  online 24/7 — deferring hosting keeps the phase's failure surface to code
  the owner can see in their own terminal. Real Telegram, real bot, real
  conversation; it simply stops when the terminal closes.
- **D-02:** Hosting + `setWebhook` are **out of scope for Phase 2** and are
  expected in Phase 3, when an always-on process starts to matter. The
  entrypoint must therefore be written so that switching to webhook mode is
  a change of *start mode only* (one env var / one branch in the bot
  entrypoint), never a rewrite of handlers. Concretely: no handler logic may
  live inside an HTTP response path, and no long-running work may be
  `await`-ed before acknowledging an update — the ack-first rule from
  `.planning/research/ARCHITECTURE.md` Pattern 1 applies to the structure of
  this phase's code even though there is no webhook yet.
- **D-03:** **One bot, one token.** A single `@…Bot` in BotFather and a
  single `TELEGRAM_BOT_TOKEN` in `.env` — no separate dev/prod bot and no
  second Supabase project at this stage.
  Consequence that MUST be handled: with long polling, two processes sharing
  one token make Telegram return **409 Conflict**. The bot must catch this
  specific error and print a plain-Russian explanation ("похоже, бот уже
  запущен в другом терминале — закрой его и запусти снова"), not a raw
  stack trace. This is a near-certain first-week papercut for the owner.

### Beta access control
- **D-04:** **Strict allowlist by `telegram_id`.** A `BETA_ALLOWLIST` env var
  holds comma-separated numeric Telegram user IDs. An **empty or unset list
  means nobody is allowed** (fail-closed), deliberately chosen over
  "empty = everyone" so an accidental deploy with a blank `.env` cannot open
  the bot to the world.
- **D-05:** The allowlist check runs as **grammY middleware, before any
  handler** — before any row is written to `users` and (in later phases)
  before any paid API call. A rejected user gets a short, polite "бот в
  закрытой бете" message and nothing else.
- **D-06:** Because the owner cannot know Telegram IDs in advance, the bot
  must make them discoverable two ways:
  1. every rejection is logged to the terminal as
     `отказ: telegram_id=<id>, @<username>` — so a friend just presses
     `/start` and the owner copies the number out of the log;
  2. a `/whoami` command replies with the caller's own `telegram_id`.
  The first-run flow is therefore two-step and MUST be documented that way
  in the phase's setup instructions: start the bot with an empty allowlist →
  send `/start` → copy your own ID from the terminal into `.env` → restart.
- **D-07:** This is spend/abuse control for a closed beta, not an
  authorization system. It is a plaintext env list changed by restarting the
  process — deliberately not a roles/subscription model, which arrives with
  the payment milestone.

### Verification approach
- **D-08:** Phase 2 is verified by **Vitest over the pure onboarding logic +
  a written manual check-list**, following the Phase 1 pattern (pure logic
  unit-tested; anything touching the outside world verified by a script or
  by hand with legible output).
  - Unit tests cover: parsing/validating each typed field (age, height,
    weight), the ≤1 kg/month rate cap, assembly of a `NutritionProfile`, and
    the handoff into `calculateNutritionTargets`.
  - The manual check-list is a document in the repo stating exactly what to
    press in Telegram and what should appear on screen, mapped to the
    phase's four success criteria.
- **D-09:** **No end-to-end Telegram-update emulation harness.** Explicitly
  rejected as disproportionate work and fragile against copy changes at this
  stage. A `verify-bot` script (getMe / DB reachability / allowlist parse)
  was offered and also not taken — do not add one unless a later phase asks.

### Claude's Discretion
The owner chose to discuss only run mode/hosting. The following are Claude's
calls, to be made by the planner in line with TECH_SPEC §3.2 and the
roadmap's success criteria — with the noted defaults as the starting point:

- **Disclaimer (ONBOARD-06)** — placement and wording. Default: show it as
  part of the targets-confirmation screen, immediately before the user
  presses "всё верно", so it is unavoidable but does not gate the first
  `/start`. ⚠ **Open item carried from STATE.md:** the final wording is the
  owner's to approve. Produce a concrete Russian draft in the plan and get
  an explicit yes before the phase is considered shipped — do not silently
  invent legal copy and move on.
- **Rate input (ONBOARD-02)** — success criterion 2 requires the *input UI
  itself* to cap at 1 kg/month, not just the formula. Default: inline
  preset buttons (0.25 / 0.5 / 0.75 / 1 кг/мес) rather than free-text entry,
  which makes exceeding the cap structurally impossible rather than
  validated after the fact. The DB `check` constraint on
  `desired_rate_kg_per_month` (0..1) stays as the last line of defence.
- **Numeric field entry** — age/height/weight are typed (per TECH_SPEC
  §3.2). Invalid input must re-prompt in Russian with a concrete example
  ("напиши число, например 178"), never crash or silently accept.
  Sensible plausibility bounds (not just "is a number") are expected.
- **Timezone** — TECH_SPEC does not specify the mechanic. Default: a short
  list of inline buttons for the realistic beta audience (Asia/Almaty,
  Asia/Aqtobe, Europe/Moscow, …) with the `users.timezone` default of
  `Asia/Almaty` as the fallback. Must store an IANA zone string, since
  Phase 4 uses it for day-boundary attribution.
- **ONBOARD-05 "изменить"** — default: restart the whole questionnaire, the
  literal reading of the requirement, and cheap on a 7-field flow. A
  per-field edit menu is a nice-to-have, not required.
- **Repeat `/start` by an already-onboarded user** — default: greet, show
  the current targets, and offer to redo onboarding, rather than silently
  restarting the questionnaire and wiping the profile.
- **Framework plumbing** — grammY version, whether to use
  `@grammyjs/conversations` vs a hand-rolled state machine, session storage,
  file layout under `src/bot/` — all Claude's call, following
  `.planning/research/ARCHITECTURE.md` (repo layout) and
  `.planning/research/STACK.md` (library choices). Constraint from Phase 1
  stands: the domain layer keeps zero Telegram imports.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & scope
- `TECH_SPEC.md` §3.1–3.2 — the `/start` flow and the exact onboarding
  field list, including "each field one at a time, inline buttons where
  possible, text input for numbers" and the confirmation screen
- `TECH_SPEC.md` §6 — target КБЖУ formulas (already implemented in Phase 1;
  read for the semantics of what the confirmation screen is displaying)
- `TECH_SPEC.md` §2 (glossary) — plain-Russian definitions the owner relies
  on, incl. what a webhook is
- `.planning/ROADMAP.md` → "Phase 2: Bot skeleton + onboarding" — goal and
  the four success criteria this phase is graded against
- `.planning/REQUIREMENTS.md` — ONBOARD-01, ONBOARD-02, ONBOARD-05,
  ONBOARD-06 (ONBOARD-03/04 are Phase 1 and already done)
- `.planning/PROJECT.md` — Core Value and Key Decisions

### Architecture & stack
- `.planning/research/ARCHITECTURE.md` — `src/bot/` component layout,
  Pattern 1 (ack-first handling, applies structurally even under polling),
  Anti-Pattern 3 (never keep conversation/draft state in process memory)
- `.planning/research/STACK.md` — grammY over Telegraf, `@grammyjs/menu` /
  `@grammyjs/conversations` plugins, Node 22 LTS
- `.planning/research/PITFALLS.md` — general implementation traps

### Prior phase decisions
- `.planning/phases/01-foundation-data-domain-math/01-CONTEXT.md` — D-01
  (Supabase, managed Postgres), D-02 (OpenAI account + spend cap), D-04
  (macro preset constants)
- `.planning/STATE.md` → "Blockers/Concerns" — the open disclaimer-wording
  item for this phase

### Project rules
- `CLAUDE.md` — owner has no backend experience: every setup step
  (BotFather, token, `.env`, first run, finding your `telegram_id`) must be
  written out literally, with what to type, what success looks like, and
  what to do when it fails

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/domain/nutrition/index.ts` — `calculateNutritionTargets()` plus the
  `NutritionProfile` / `NutritionTargets` / `Sex` / `ActivityLevel` / `Goal`
  types. This is the *only* entry point onboarding should use for the math;
  its barrel comment already names Phase 2 as the intended consumer. Fully
  unit-tested in Phase 1 — do not reimplement or "adjust" any formula here.
- `src/db/schema/users.ts` — every onboarding field already has a column
  (`sex`, `ageYears`, `heightCm`, `weightKg`, `activityLevel`, `goal`,
  `desiredRateKgPerMonth`, `timezone` default `Asia/Almaty`), plus
  `targetKcal` / `targetProteinG` / `targetFatG` / `targetCarbsG` and
  `onboardedAt`. **No migration should be needed for onboarding itself** —
  if the planner thinks one is, that is a signal to re-read this file first.
  Postgres `check` constraints already enforce the sex/activity/goal
  literals and the 0..1 kg/month rate cap.
- `src/db/client.ts` — `createDb()` / `closeDb()`; lazy, cached Drizzle
  client over postgres.js. The bot must use this, not open its own pool.
- `src/config/env.ts` — `loadEnv()` + `REQUIRED_ENV_KEYS`, the single place
  in the codebase allowed to read `process.env` for required config. Adding
  `TELEGRAM_BOT_TOKEN` and `BETA_ALLOWLIST` means updating
  `REQUIRED_ENV_KEYS`, `AppEnv`, **and** `.env.example` — `env.test.ts`
  asserts the key list and `.env.example` stay in sync, and dotenv-safe
  fails startup on any declared-but-empty key. Decide deliberately whether
  `BETA_ALLOWLIST` is required-but-may-be-empty (note: `allowEmptyValues:
  false` is currently set, so an empty value fails — the allowlist may need
  handling outside `REQUIRED_ENV_KEYS`).
- `scripts/check-setup.ts` and the `verify-*` scripts — the established
  house style for owner-facing diagnostics: plain-Russian output, explicit
  "what to do next" on failure. Reuse that voice for the bot's 409 handler
  and allowlist-rejection log.

### Established Patterns
- Hexagonal boundary: `src/domain/**` has zero Telegram and zero DB-driver
  imports. The bot layer adapts Telegram input into domain types, never the
  reverse.
- Nothing reads `process.env` directly; nothing opens a DB connection at
  module import time (so importing a module in a test never needs `.env`).
- User-facing and operator-facing error text is in Russian and actionable.
- ESM with `.js` import specifiers, `tsx` to run TypeScript directly, Vitest
  for tests, npm scripts as the owner's interface to everything.

### Integration Points
- New `src/bot/**` is the first consumer of `src/domain/nutrition`.
- New `npm run bot` script joins the existing script list in `package.json`.
- `users` table gets its first real writes (Phase 1 only created the schema).
- Phase 3 will attach voice/text handlers to this same bot instance and will
  flip the entrypoint from polling to webhook — hence D-02's start-mode seam.

</code_context>

<specifics>
## Specific Ideas

- The owner asked directly how they would ever obtain a `telegram_id`. The
  answer shaped D-06: the bot itself is the discovery mechanism (rejection
  log + `/whoami`), so neither the owner nor their friends need to be told
  to go find a third-party bot. Any plan that assumes IDs are known upfront
  is wrong.

</specifics>

<deferred>
## Deferred Ideas

- **Deploy to a hosting provider + webhook mode** — expected in Phase 3,
  when the bot needs to be reachable without the owner's terminal open.
  Phase 2 leaves the start-mode seam ready (D-02).
- **Separate dev/prod bot tokens (and/or a second Supabase project)** —
  considered and rejected for now (D-03); revisit when real beta users would
  be disrupted by experiments.
- **`npm run verify-bot` diagnostic script** — offered, not taken (D-09).
- **End-to-end Telegram-update emulation tests** — offered, not taken (D-09).
- **Per-field edit menu instead of full onboarding restart** — nice-to-have
  beyond ONBOARD-05's literal requirement.

</deferred>

---

*Phase: 2-Bot skeleton + onboarding*
*Context gathered: 2026-08-11*
