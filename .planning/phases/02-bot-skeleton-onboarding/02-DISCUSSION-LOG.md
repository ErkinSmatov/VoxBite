# Phase 2: Bot skeleton + onboarding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-11
**Phase:** 2-bot-skeleton-onboarding
**Areas discussed:** Запуск и хостинг бота

---

## Gray area selection

Four gray areas were offered: run mode/hosting, disclaimer (ONBOARD-06),
field-input mechanics (rate cap UI / numeric validation / timezone), and the
targets screen + "изменить" behaviour. The owner selected **only** run mode
and hosting; the other three fell to Claude's discretion.

---

## Запуск и хостинг бота

### Q1 — How should the bot run at the end of Phase 2?

| Option | Description | Selected |
|--------|-------------|----------|
| Polling локально (recommended) | `npm run bot` on the owner's machine; zero infra, zero cost, errors visible in the terminal; webhook stays one env var away; deploy deferred to Phase 3 | ✓ |
| Сразу деплой + webhook | Phase 2 includes hosting setup (Railway/Render/Fly), autodeploy, server env vars, `setWebhook`; ~$5/mo and a new class of debugging while there is nothing interesting to debug yet | |
| Polling + деплой в конце фазы | Develop on polling, but still ship to hosting as the last step, to hit deploy surprises on simple code rather than alongside STT/LLM in Phase 3 | |

**User's choice:** Polling локально
**Notes:** Claude flagged upfront that polling vs webhook is two lines in
grammY, not an architectural fork — provided handler work never sits inside
an HTTP response path (already mandated by ARCHITECTURE.md Pattern 1).

### Q2 — How many bots in BotFather?

| Option | Description | Selected |
|--------|-------------|----------|
| Один бот пока (recommended) | Single `TELEGRAM_BOT_TOKEN`; simplest with no users yet; add explicit 409-Conflict handling with a plain-Russian hint | ✓ |
| Два: dev и prod | Separate experiment bot; costs two env sets and risks confusion over which DB is being written, since Supabase is shared anyway | |
| Два бота + две БД | Full dev/prod split incl. a second Supabase project; would mean running migrations twice and re-paying for FDC embeddings | |

**User's choice:** Один бот пока
**Notes:** Claude raised the 409 Conflict failure mode before the question —
two polling processes on one token — as the reason this choice needs an
explicit error-handling deliverable rather than being free.

### Q3 — How does the bot react to a stranger who finds it and presses /start?

| Option | Description | Selected |
|--------|-------------|----------|
| Allowlist по telegram_id (recommended) | `BETA_ALLOWLIST` env var; strangers get a polite refusal before any DB write or paid call | |
| Открыт всем | Safe on Phase 2 (no external spend), but the limit would have to be retrofitted in Phase 3 | |
| Секретный код-приглашение | Code word before the questionnaire; no need to learn anyone's ID, but an extra onboarding step and the code leaks by forwarding | |

**User's response:** *"если мы делаем по telegram_id то как мне его получать?"* (free text)

**Notes:** Answered in plain text rather than another question card. Three
ways to obtain a `telegram_id` were explained (bot logs the ID of anyone
refused; `@userinfobot`; the owner's own ID from the first run). Claude
recommended making the bot itself the discovery mechanism plus a `/whoami`
command, and stated the limitation explicitly: this is spend/abuse control,
not an authorization system.

### Q3b — Given that, do we build the allowlist?

| Option | Description | Selected |
|--------|-------------|----------|
| Да, allowlist + лог + /whoami | Empty list = let everyone in, so the bot is not a brick on first run | |
| Да, но строго | Same, but empty list = nobody allowed; safer against a blank `.env`, at the cost of a two-step first run | ✓ |
| Нет, открыт всем | Defer the limit to Phase 3, before the first paid API call | |

**User's choice:** Да, но строго (fail-closed)
**Notes:** Consequence accepted: first run is two-step — start with an empty
allowlist, send `/start`, copy your own ID out of the terminal log into
`.env`, restart. To be documented step by step in the plan.

### Q4 — How do we verify the skeleton and onboarding work?

| Option | Description | Selected |
|--------|-------------|----------|
| Тесты + ручной чек-лист (recommended) | Vitest over pure questionnaire logic (number parsing, validation, 1 kg/month cap, profile assembly → `calculateTargets`) plus a written check-list of what to press in Telegram and what should appear | ✓ |
| + скрипт verify-bot | Additionally `npm run verify-bot`: getMe, DB reachability, allowlist parse — answers "is my setup right?" without starting the bot | |
| Автотест всего диалога | Emulate Telegram updates and drive the whole onboarding in tests; fullest coverage, but much more work and brittle against copy changes | |

**User's choice:** Тесты + ручной чек-лист
**Notes:** Follows the Phase 1 house pattern (pure logic unit-tested,
outside-world checks scripted or done by hand with legible output).

### Area close

Asked whether to continue in this area, return to the unselected areas, or
move on. **User's choice:** Двигаемся дальше — remaining areas left to
Claude's discretion.

---

## Claude's Discretion

Not discussed; defaults recorded in CONTEXT.md `<decisions>` → "Claude's
Discretion":

- Disclaimer (ONBOARD-06) placement and wording — ⚠ final Russian copy still
  needs the owner's explicit approval (open item inherited from STATE.md)
- Rate input UI (preset buttons vs free text) satisfying success criterion 2
- Numeric field validation and re-prompt behaviour
- Timezone question mechanic (IANA string required for Phase 4)
- ONBOARD-05 "изменить" = full restart vs per-field edit
- Behaviour of a repeat `/start` from an already-onboarded user
- grammY version, conversations/session plugin choice, `src/bot/` layout

## Deferred Ideas

- Hosting deploy + webhook mode → Phase 3
- Separate dev/prod bot tokens and/or second Supabase project → revisit when
  real beta users could be disrupted
- `npm run verify-bot` diagnostic script → offered, not taken
- End-to-end Telegram-update emulation tests → offered, not taken
- Per-field edit menu instead of full onboarding restart → nice-to-have
