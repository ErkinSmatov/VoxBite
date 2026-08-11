# Phase 2: Bot skeleton + onboarding - Research

**Researched:** 2026-08-11
**Domain:** grammY Telegram bot (long polling), multi-step conversation state, Postgres-backed session storage
**Confidence:** HIGH (grammY core APIs, package versions — verified via npm + official docs) / MEDIUM (409 polling-error surfacing — verified via grammY source but not exercised live in this session)

## Summary

Phase 2 is a thin, well-bounded slice: one grammY bot process, one conversation
(`/start` → 7 fields → confirm), and an allowlist gate — all built on top of
the already-complete Phase 1 domain layer and `users` table. The single
highest-risk unknown named in the task brief — the current
`@grammyjs/conversations` API — turned out to be a real risk: the plugin is
on **major version 2** (2.1.1), and v1-era tutorials/blog posts (which
dominate search results and training data) describe a meaningfully different
API. This research confirms the current v2 shape directly from grammY's own
docs: `conversation.waitFor(...)`, `conversation.external(...)` for all
non-replayable side effects, and a documented `StorageAdapter` interface for
persistence — no first-party Postgres adapter package exists, so Phase 2 must
write a ~15-line custom adapter over the existing Drizzle/postgres.js client.

The second major finding is that **grammY's `bot.catch()` does not see
`getUpdates` polling errors** (409 Conflict included) — that error path is
separate from the middleware error pipeline D-03 implicitly assumed. The
correct fix is a `try/catch` around the top-level `await bot.start(...)`
call, because grammY's polling loop explicitly rethrows on HTTP 401/409
(all other errors are retried with backoff internally) — this is directly
verifiable in grammY's own source and matches D-03's requirement without
needing `bot.catch()` at all.

Third, `.env`'s `dotenv-safe` contract (`allowEmptyValues: false`) initially
looks like it conflicts with D-04's "empty `BETA_ALLOWLIST` must be legal,"
but reading `src/config/env.ts` closely shows the conflict is illusory:
`dotenvSafe.config()`'s own required-key check is already wrapped in a
try/catch that **swallows** its error and falls through to a separate,
hand-rolled `missingKeys` filter driven purely by `REQUIRED_ENV_KEYS`. That
means `BETA_ALLOWLIST` simply must never be added to `REQUIRED_ENV_KEYS` (or
to a bare `KEY=` line in `.env.example`, since `env.test.ts` asserts those
two lists match 1:1) — it needs a parallel, explicitly-optional key concept
alongside the existing required-key one.

**Primary recommendation:** Use `@grammyjs/conversations` v2.1.1 +
`@grammyjs/menu` v1.4.0 for onboarding, with a small custom Postgres
`StorageAdapter` (not a community package — none exists) for conversation
state, `try/catch` around `bot.start()` for the 409 case, and an extended
`env.ts` with a second `OPTIONAL_ENV_KEYS`-style concept for `BETA_ALLOWLIST`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/start` command, onboarding conversation, inline keyboards | Bot layer (`src/bot/`) | — | Telegram-specific UX; only place grammY types appear, per `ARCHITECTURE.md` |
| Allowlist gate | Bot layer (middleware) | — | Must run before any handler touches DB or domain, per D-05; Telegram-adjacent (reads `ctx.from`), not a domain concern |
| Field parsing/validation (age/height/weight, rate cap) | Domain-adjacent pure functions (new `src/bot/onboarding/` or `src/domain/onboarding/` pure module) | Bot layer calls it | Must be unit-testable with zero grammY imports per D-08 — this is the seam |
| Target calorie/macro calculation | Domain (`src/domain/nutrition`) | — | Already built in Phase 1; Phase 2 is a pure consumer, no new domain code |
| Conversation/session persistence | Postgres (via a new custom `StorageAdapter`) | — | D-02/Anti-Pattern 3 forbid in-process state; existing Postgres is the only approved store, no Redis in this phase |
| User profile persistence (`users` table) | Postgres (Drizzle, `src/db/`) | — | Schema already exists (Phase 1); Phase 2 does its first real writes |
| Run mode (polling now, webhook later) | Bot entrypoint (`src/bot/index.ts` or similar) | — | D-01/D-02: one branch, isolated from handler code |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D-01:** Bot runs via grammY **long polling** on the owner's machine
  (`npm run bot`), not a deployed webhook.
- **D-02:** Hosting + `setWebhook` are out of scope for Phase 2, expected in
  Phase 3. Entrypoint must be written so switching to webhook mode is a
  change of *start mode only* — no handler logic in an HTTP response path,
  no long-running `await` before acknowledging an update (ack-first rule
  from `ARCHITECTURE.md` Pattern 1 applies structurally even without a
  webhook yet).
- **D-03:** **One bot, one token.** Single `TELEGRAM_BOT_TOKEN` in `.env`.
  With long polling, two processes sharing one token cause Telegram to
  return **409 Conflict** — bot must catch this specific error and print a
  plain-Russian explanation, not a raw stack trace.
- **D-04:** **Strict allowlist by `telegram_id`.** `BETA_ALLOWLIST` env var
  holds comma-separated numeric Telegram user IDs. Empty or unset means
  **nobody is allowed** (fail-closed).
- **D-05:** Allowlist check runs as **grammY middleware, before any
  handler** — before any row is written to `users`. Rejected users get a
  short, polite "бот в закрытой бете" message.
- **D-06:** Bot must make Telegram IDs discoverable two ways: (1) every
  rejection logged to terminal as `отказ: telegram_id=<id>, @<username>`;
  (2) a `/whoami` command replies with the caller's own `telegram_id`.
  First-run flow is two-step and must be documented as such: start with
  empty allowlist → `/start` → copy ID from terminal log → add to `.env` →
  restart.
- **D-07:** This is spend/abuse control for a closed beta, not an
  authorization system — plaintext env list, restart to change. Not a
  roles/subscription model.
- **D-08:** Phase 2 verified by **Vitest over pure onboarding logic + a
  written manual check-list**. Unit tests cover: parsing/validating each
  typed field (age, height, weight), the ≤1 kg/month rate cap, assembly of
  a `NutritionProfile`, and the handoff into `calculateNutritionTargets`.
  Manual check-list is a repo document stating exactly what to press in
  Telegram and what should appear, mapped to the phase's four success
  criteria.
- **D-09:** **No end-to-end Telegram-update emulation harness.** Explicitly
  rejected. A `verify-bot` diagnostic script was offered and also not
  taken — do not add one unless a later phase asks.

### Claude's Discretion

- **Disclaimer (ONBOARD-06)** — placement/wording. Default: part of the
  targets-confirmation screen, immediately before "всё верно." Final
  wording needs explicit owner sign-off before shipping — do not silently
  invent legal copy.
- **Rate input (ONBOARD-02)** — Default: inline preset buttons (0.25 / 0.5
  / 0.75 / 1 кг/мес), not free-text, so the cap is structurally impossible
  to exceed via the UI. DB `check` constraint (0..1) stays as last line of
  defence (already exists in `users` schema).
- **Numeric field entry** — age/height/weight are typed. Invalid input
  re-prompts in Russian with a concrete example, never crashes or silently
  accepts. Plausibility bounds expected (not just "is a number").
- **Timezone** — short list of inline buttons (Asia/Almaty, Asia/Aqtobe,
  Europe/Moscow, …), default `Asia/Almaty` (matches schema default). Must
  store an IANA zone string (Phase 4 needs it for day-boundary attribution).
- **ONBOARD-05 "изменить"** — default: restart the whole questionnaire
  (literal reading, cheap on a 7-field flow). Per-field edit menu is a
  nice-to-have, not required.
- **Repeat `/start` by an already-onboarded user** — default: greet, show
  current targets, offer to redo onboarding — do not silently restart and
  wipe the profile.
- **Framework plumbing** — grammY version, `@grammyjs/conversations` vs
  hand-rolled state machine, session storage, `src/bot/` file layout — all
  Claude's call (this research answers these). Domain layer keeps zero
  Telegram imports.

### Deferred Ideas (OUT OF SCOPE)

- Deploy to a hosting provider + webhook mode — Phase 3.
- Separate dev/prod bot tokens / second Supabase project — rejected for now.
- `npm run verify-bot` diagnostic script — offered, not taken (D-09).
- End-to-end Telegram-update emulation tests — offered, not taken (D-09).
- Per-field edit menu instead of full onboarding restart — nice-to-have
  beyond ONBOARD-05's literal requirement.

</user_constraints>

## Phase Requirements

<phase_requirements>

| ID | Description | Research Support |
|----|-------------|------------------|
| ONBOARD-01 | User completes onboarding: sex, age, height, weight, activity, goal, timezone | `@grammyjs/conversations` v2 `waitFor`/`waitForHears` patterns (Code Examples); inline-button + text-input mix via `@grammyjs/menu` + plain `waitFor(':text')` |
| ONBOARD-02 | Rate cap ≤1 kg/month, enforced by input UI not just formula | Inline preset-button pattern (Code Examples); `MAX_RATE_KG_PER_MONTH` already enforced twice (domain function + DB check) — UI is the third, requested layer |
| ONBOARD-05 | User sees targets, can confirm or restart onboarding | `conversation.enter()`/re-entry pattern; `users.onboardedAt` nullable column already models "in progress vs complete" |
| ONBOARD-06 | Non-medical-device disclaimer shown before targets confirmed | Placement recommendation in Common Pitfalls + Code Examples; wording is an explicit owner-approval gate, not a research question |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|---------------|
| `grammy` | 1.45.1 [VERIFIED: npm registry] | Telegram bot framework | Already the project's locked choice (`STACK.md`); latest is 1.45.1, published within the last month — active maintenance |
| `@grammyjs/conversations` | 2.1.1 [VERIFIED: npm registry] | Multi-step onboarding flow | Official grammY plugin; peer dep `grammy ^1.20.1` — compatible. **Major version 2** — do not follow v1-era tutorials (see Pitfall 1) |
| `@grammyjs/menu` | 1.4.0 [VERIFIED: npm registry, published 2 days before this research] | Inline keyboards (sex/activity/goal/rate/timezone pickers) | Official plugin; peer dep `grammy ^1.40.0` — compatible with 1.45.1; has first-class `conversation.menu()` integration in v2 conversations (see Priority Question 2) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| none new | — | — | Phase 2 needs no new adapter/API-client libraries — no STT/LLM/embeddings involved. `postgres`, `drizzle-orm`, `dotenv-safe` are already installed from Phase 1 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@grammyjs/conversations` | Hand-rolled state machine keyed by chat_id in Postgres | More code to write and get right (replay semantics, wait-point resumption) for a well-solved problem; conversations plugin is official, actively maintained, and directly matches ARCHITECTURE.md's "grammY sessions or hand-rolled state machine" note — no reason to hand-roll here |
| Custom Postgres `StorageAdapter` | `@grammyjs/storage-redis` / a hosted Redis | Adds a second infra dependency (Redis) the owner would have to provision — explicitly against this project's whole "avoid infra the owner doesn't need yet" posture; no official Postgres storage package exists on npm (verified: `@grammyjs/storage-postgres` returns 404) |
| Custom Postgres `StorageAdapter` | `@grammyjs/storage-file` (JSON file on disk) | Simpler to write, but violates Anti-Pattern 3's spirit (state should live in the durable system of record, not a file the owner could delete/lose) and doesn't share a home with `users`/future `diary_draft` tables |
| Inline preset rate buttons | Free-text rate entry + backend clamp | Rejected explicitly by CONTEXT.md D-discretion default — success criterion 2 requires the cap to be structural, not just validated after entry |

**Installation:**
```bash
npm install grammy@1.45.1 @grammyjs/conversations@2.1.1 @grammyjs/menu@1.4.0
```

**Version verification:** All three versions confirmed via `npm view <pkg> version` and `npm view <pkg> peerDependencies` during this research session (2026-08-11). `@grammyjs/menu` was published 2 days before this research — worth a final `npm outdated` check at implementation time given the very recent release.

## Architecture Patterns

### System Architecture Diagram

```
Telegram (long polling — bot.start())
      │  Update (message / callback_query)
      ▼
┌─────────────────────────────────────────────────────────────┐
│ src/bot/index.ts — entrypoint                                │
│  bot.use(allowlistMiddleware)  ◄── D-05: runs before ANYTHING │
│  bot.use(session({ storage: pgSessionAdapter }))              │
│  bot.use(conversations())                                     │
│  bot.use(createConversation(onboardingConversation))          │
│  bot.command('start', ...)                                    │
│  bot.command('whoami', ...)   ◄── D-06                        │
│  bot.catch(...)               ◄── middleware errors only      │
└───────────────┬────────────────────────────────────────────--┘
                │ allowlist reject → log "отказ: ..." + polite msg, STOP
                │ allowlist pass
                ▼
┌─────────────────────────────────────────────────────────────┐
│ onboardingConversation(conversation, ctx)                     │
│  for each of 7 fields:                                        │
│    ask (text or inline menu)                                  │
│    conversation.waitFor(...) / menu callback                  │
│    parse+validate via PURE function (src/bot/onboarding/*)     │
│      invalid → re-prompt in Russian, loop                     │
│  conversation.external(() => calculateNutritionTargets(...))  │
│    (pure function, but wrapped per the "wrap anything          │
│     non-replay-safe" rule — see Pitfall 2)                     │
│  show disclaimer + targets + [подтвердить] [заново]            │
│  conversation.waitFor('callback_query')                        │
│    подтвердить → conversation.external(() => db.insert(users)) │
│    заново      → conversation.reenter() / loop to top          │
└───────────────┬────────────────────────────────────────────--┘
                ▼
        Postgres: users row written (first real write, Phase 1
        only created schema) + conversation session row
        (separate table/adapter, ephemeral vs. durable)

Top-level entrypoint:
try { await bot.start({ onStart: ... }) }
catch (e) {
  if (e instanceof GrammyError && e.error_code === 409) {
    print plain-Russian "уже запущен в другом терминале" (D-03)
  } else { rethrow / log }
}
```

### Recommended Project Structure

```
src/
├── bot/
│   ├── index.ts               # entrypoint: builds Bot, registers middleware in order,
│   │                           #   branches polling-vs-webhook (D-02 seam), try/catch 409 (D-03)
│   ├── middleware/
│   │   └── allowlist.ts       # D-04/D-05: parses BETA_ALLOWLIST, rejects + logs
│   ├── storage/
│   │   └── pg-storage-adapter.ts  # custom StorageAdapter over Drizzle/postgres.js
│   ├── conversations/
│   │   └── onboarding.ts      # the createConversation() function — grammY-typed,
│   │                           #   but delegates all parsing/math to the pure module below
│   ├── keyboards/
│   │   └── onboarding-menus.ts # @grammyjs/menu builders: sex, activity, goal, rate, timezone
│   ├── commands/
│   │   ├── start.ts
│   │   └── whoami.ts          # D-06
│   └── formatting/
│       └── onboarding-copy.ts # Russian message templates, incl. disclaimer text (ONBOARD-06)
│
├── bot/onboarding/  (or promote to src/application/onboarding/ — see Open Questions)
│   ├── parse-fields.ts        # PURE: parseAge(text), parseHeight(text), parseWeight(text) →
│   │                           #   {ok:true,value} | {ok:false,error:string}, zero grammY imports
│   ├── rate-presets.ts        # PURE: the 4 allowed preset values, already capped at 1
│   └── assemble-profile.ts    # PURE: draft answers → NutritionProfile (Phase 1 type)
│
└── domain/nutrition/          # UNCHANGED — Phase 2 only calls calculateNutritionTargets()
```

### Structure Rationale

This directly extends `ARCHITECTURE.md`'s existing `bot/` vs `domain/` boundary. The one addition ARCHITECTURE.md didn't fully specify: **the parsing/validation/assembly logic that sits between "raw Telegram text" and "typed `NutritionProfile`" must itself be a separate, pure, grammY-free module** — not inlined into the conversation function — because D-08 requires it to be Vitest-unit-testable with zero grammY imports. Putting it in `src/bot/onboarding/*` (co-located, but with a hard "no grammY import" rule enforced by convention/lint) or promoting it to `src/application/onboarding/*` (matching ARCHITECTURE.md's existing `application/onboarding-flow.ts` naming) are both reasonable — this is flagged as an Open Question for the planner to settle, not a locked call.

### Pattern 1: Conversation function calls only pure functions for logic, `conversation.external()` for everything else

**What:** The `createConversation()` function itself contains only orchestration (ask → wait → branch); every parse/validate/calculate call goes to a plain function from `src/bot/onboarding/*` or `src/domain/nutrition`; every DB write, `Date.now()`, or random ID goes through `conversation.external()`.
**When to use:** Always, for this conversation — it is simultaneously the thing that makes D-08's unit-testing goal possible (pure functions are trivially testable without a `Conversation` mock) and the thing that makes the plugin's replay mechanism safe (see Pitfall 2 below).
**Example:**
```typescript
// src/bot/conversations/onboarding.ts
import type { Conversation } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import { parseAge, parseHeight, parseWeight } from '../onboarding/parse-fields.js';
import { calculateNutritionTargets } from '../../domain/nutrition/index.js';

export async function onboardingConversation(conversation: Conversation, ctx: Context) {
  await ctx.reply('Какой у тебя пол?', { reply_markup: sexMenu });
  const sexCtx = await conversation.waitFor('callback_query:data');
  const sex = sexCtx.callbackQuery.data as 'male' | 'female';

  let age: number | undefined;
  while (age === undefined) {
    await ctx.reply('Сколько тебе лет? Напиши число, например 29');
    const { message } = await conversation.waitFor('message:text');
    const result = parseAge(message.text); // PURE — Source: this repo's src/bot/onboarding/parse-fields.ts
    if (result.ok) {
      age = result.value;
    } else {
      await ctx.reply(result.error);
    }
  }

  // ... height, weight, activity, goal, rate, timezone follow the same shape ...

  const targets = await conversation.external(() =>
    calculateNutritionTargets({ sex, ageYears: age!, /* ...rest */ }),
  );

  await ctx.reply(disclaimerAndTargetsMessage(targets), { reply_markup: confirmMenu });
  const confirmCtx = await conversation.waitFor('callback_query:data');
  if (confirmCtx.callbackQuery.data === 'confirm') {
    await conversation.external(() => saveOnboardedUser(ctx.from!.id, /* fields */, targets));
    await ctx.reply('Готово! Твои цели сохранены.');
  } else {
    await ctx.reply('Хорошо, начнём заново.');
    await conversation.reenter?.(); // or a plain recursive call — see Open Questions
  }
}
```

### Pattern 2: `conversation.external()` for the calculation call, even though it's pure

**What:** Even though `calculateNutritionTargets()` has no I/O, grammY's own docs state the rule is about **replay-safety**, not about I/O — any code whose *result* must stay identical across replays (which includes anything reading `Date.now()`/`Math.random()` transitively, and by the plugin's own stated golden rule, "code behaving differently between replays") should go through `external()`. `calculateNutritionTargets()` itself is fully deterministic given identical inputs, so wrapping it is a defensive, cheap safety margin rather than a strict requirement — but treating "is this deterministic AND side-effect-free" as the bar (not "does it touch a database") avoids a subtle bug class if a later phase adds any non-determinism to that function.
**When to use:** Any call whose behavior could plausibly change between the conversation's first run and its replay after a restart (DB reads/writes always; calculations are optional-but-recommended for defense-in-depth).
**Source:** grammY conversations plugin docs, "Persisting Data" / golden rule section (fetched 2026-08-11).

### Pattern 3: Allowlist middleware registered before session/conversations middleware

**What:** `bot.use(allowlistMiddleware)` must be the **first** `bot.use()` call, before `session()` and `conversations()`, so a rejected user's update never even reaches session storage read/write or conversation dispatch.
**When to use:** Always — this is D-05's literal requirement ("before any handler"), and also avoids wasted Postgres round-trips (session read) for users who will be rejected anyway.
**Example:**
```typescript
// src/bot/index.ts
bot.use(allowlistMiddleware);       // D-05: first, always
bot.use(session({ storage: pgStorageAdapter, initial: () => ({}) }));
bot.use(conversations());
bot.use(createConversation(onboardingConversation));
bot.command('whoami', whoamiHandler); // must be reachable even for non-allowlisted users? — see Open Questions
```
**Caveat found during research:** `/whoami` (D-06) must be reachable specifically so a *not-yet-allowlisted* user's request is useful — but if allowlist middleware runs first and calls `next()` conditionally, a rejected user's `/whoami` would also be blocked, which is fine (D-06's flow is "the rejection log line already contains the ID" — `/whoami` is a convenience for the owner's own first run, not required to work pre-allowlist for arbitrary users). Confirm this reading with the planner; it does not block research.

### Anti-Patterns to Avoid

- **Reading `ctx.session` or awaiting a DB call directly inside a conversation function without `conversation.external()`:** breaks replay — grammY's docs are explicit that this is the #1 source of conversation state corruption. Always route through `external()`.
- **Treating `@grammyjs/menu` state as conversation-safe by default:** the menu plugin's own middleware runs independently of the conversation replay mechanism; use `conversation.menu()` (the v2-documented integration point) rather than a plain top-level `bot.use(menu)` when the menu's choice needs to feed back into a `waitFor`-based flow.
- **Putting `TELEGRAM_BOT_TOKEN`/`BETA_ALLOWLIST` parsing inline in `bot/index.ts`:** follow the existing `src/config/env.ts` convention — extend that module, don't add a second `process.env` reader (see Priority Question 8 below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Multi-step conversational flow with resumable state | A custom state machine keyed by chat_id | `@grammyjs/conversations` v2 | Official, actively maintained, solves replay/resumption correctly (the hard part); ARCHITECTURE.md already names it as the intended tool |
| Inline keyboard construction + callback_data routing | Manual `callback_data` string parsing + `bot.on('callback_query:data', ...)` switch statements | `@grammyjs/menu` | Declarative, stateful, avoids the classic "callback_data string got too long / collided" class of bugs |
| Comma-separated numeric ID allowlist parsing | A bespoke parser with ad-hoc trimming/validation | A ~5-line `parseAllowlist(raw: string): number[]` pure function, tested directly — this is simple enough that no library is warranted, but it MUST be a pure, tested function, not inlined string-splitting in middleware | Keeps it testable per D-08's spirit and avoids silent bugs like trailing commas producing `NaN` entries that silently never match `ctx.from.id` |

**Key insight:** The two "don't hand-roll" items here are both official grammY ecosystem plugins already implicitly named in this project's own research documents (`STACK.md`, `ARCHITECTURE.md`) — the work in this phase is applying them correctly (v2 API, replay-safety, Postgres storage), not choosing them.

## Common Pitfalls

### Pitfall 1: Writing v1-era `@grammyjs/conversations` code from training knowledge or search results

**What goes wrong:** The installed/current version is 2.1.1, but a large fraction of tutorials, StackOverflow answers, and blog posts (and likely a fair amount of an LLM's training data) describe v1's API, which had different replay semantics and lacked the `external()`/`waitFor()` shape confirmed above.
**Why it happens:** v1 was the dominant version for a long time; v2 is a fairly recent major bump (npm shows 2.0.0 released after a run of 1.x/0.x versions).
**How to avoid:** Any code written for this phase must match the syntax verified in this document (`conversation.waitFor(...)`, `conversation.external(...)`, `conversations()` + `createConversation()`, `StorageAdapter`-based persistence) — treat any snippet using different method names (e.g., `conversation.form.text()`, older `enterConversation` patterns) as suspect and re-verify against `grammy.dev/plugins/conversations` before using.
**Warning signs:** TypeScript errors about missing methods on the `Conversation` type; runtime errors about "conversation function behaved differently" (a real, documented v2 error class for replay violations).

### Pitfall 2: Forgetting the DB write inside `conversation.external()` and losing replay safety

**What goes wrong:** `await db.insert(users).values(...)` called directly inside the conversation function runs again on every replay (since grammY replays the whole function up to the last wait point after every incoming update) — meaning the user's `users` row could theoretically be written multiple times, or worse, written with stale partial data if a crash happens mid-conversation and the replay re-executes from the top.
**Why it happens:** It's the natural way to write async code and the failure mode isn't visible until you cause an actual replay (bot restart mid-conversation, or a lagged additional update arriving).
**How to avoid:** Every `db.insert`/`db.update` call inside the conversation function must be wrapped: `await conversation.external(() => db.insert(users).values(...))`. Additionally, prefer an idempotent `onConflictDoUpdate` on `telegramId` for the final save, as a second line of defence (matches the general idempotency discipline already established for Phase 3's `update_id` handling in `ARCHITECTURE.md`).
**Warning signs:** Duplicate or partially-overwritten `users` rows after testing a "restart the bot mid-onboarding" manual scenario (this should be one of the D-08 manual check-list items).

### Pitfall 3: `bot.catch()` silently never firing for the 409 Conflict case

**What goes wrong:** A natural (and CONTEXT.md D-03's own phrasing lightly implies) first attempt is to register a `bot.catch((err) => { if (err.error instanceof GrammyError && err.error.error_code === 409) {...} })` handler, expecting it to catch the "another instance is polling" error. It never fires for this case.
**Why it happens:** `bot.catch()` only receives errors thrown by **middleware** (i.e., errors during update processing). The `getUpdates` HTTP call itself — where a 409 actually originates — happens in grammY's internal polling loop (`fetchUpdates`/`loop`), which is architecturally separate from middleware dispatch. Verified directly against grammY's `src/bot.ts`: the polling loop's `handlePollingError()` explicitly **rethrows** on HTTP 401/409 (all other transient errors are retried with exponential backoff, capped at 20 minutes) — the rethrow propagates out of the `await bot.start()` call itself, not through `bot.catch()`.
**How to avoid:** Wrap the top-level `await bot.start(...)` call in a `try/catch` in the entrypoint:
```typescript
import { Bot, GrammyError, HttpError } from 'grammy';

try {
  await bot.start({
    onStart: (botInfo) => console.log(`Бот запущен: @${botInfo.username}`),
  });
} catch (err) {
  if (err instanceof GrammyError && err.error_code === 409) {
    console.error(
      'похоже, бот уже запущен в другом терминале — закрой его и запусти снова',
    );
    process.exit(1);
  }
  if (err instanceof HttpError) {
    console.error('Не удалось подключиться к Telegram — проверь интернет-соединение:', err.message);
    process.exit(1);
  }
  throw err;
}
```
Keep `bot.catch()` too, but for its actual purpose — middleware errors during update handling (e.g., a bug in the onboarding conversation), not the 409 case.
**Warning signs:** A `bot.catch()` handler that "should" fire for 409 but a raw stack trace appears in the terminal instead — this is the exact symptom D-03 is trying to prevent, so this pitfall must be closed before calling the phase done.
**Confidence:** MEDIUM — verified via grammY's public GitHub source (`src/bot.ts`, `handlePollingError`) through a documentation fetch in this session, not by triggering a live 409 in this environment. Recommend the manual check-list (D-08) include an explicit "run `npm run bot` twice at once, confirm plain-Russian message, not a stack trace" step to close this gap empirically.

### Pitfall 4: `.env.example`/`env.test.ts`'s strict-equality contract breaking on `BETA_ALLOWLIST`

**What goes wrong:** Adding `TELEGRAM_BOT_TOKEN=` and `BETA_ALLOWLIST=` as ordinary lines to `.env.example` and adding both keys to `REQUIRED_ENV_KEYS` looks like the obvious move — but it directly contradicts D-04 ("empty allowlist must be legal, not a startup error"), because `loadEnv()`'s `missingKeys` filter treats an empty string as missing for every key in `REQUIRED_ENV_KEYS`, and would throw on first run with an empty allowlist — exactly the state D-06's documented two-step first-run flow requires to work.
**Why it happens:** `REQUIRED_ENV_KEYS` currently conflates two different things that happen to overlap for `DATABASE_URL`/`OPENAI_API_KEY` (both "must be declared in `.env.example`" and "must be non-empty") — Phase 2 is the first key that needs the first property without the second.
**How to avoid:** Introduce a second, parallel concept — e.g. `OPTIONAL_ENV_KEYS` — and update both `env.ts` and its test:
```typescript
// src/config/env.ts (sketch — planner should finalize exact shape)
export const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'OPENAI_API_KEY', 'TELEGRAM_BOT_TOKEN'] as const;
export const OPTIONAL_ENV_KEYS = ['BETA_ALLOWLIST'] as const; // may be declared+empty; loaded, never required

export interface AppEnv {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  BETA_ALLOWLIST: string; // '' is a legal, meaningful value (fail-closed empty allowlist)
}
```
And update `env.test.ts`'s equality assertion to compare `.env.example`'s declared keys against `[...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS]` instead of `REQUIRED_ENV_KEYS` alone. Note also: `dotenvSafe.config()`'s own internal required-vs-example check is *already* wrapped in a try/catch in the current `loadEnv()` that swallows its error unconditionally — so `dotenv-safe`'s `allowEmptyValues: false` setting does not actually block an empty `BETA_ALLOWLIST` today; the real enforcement is 100% the hand-rolled `missingKeys` filter. This means the fix is purely additive (new array + one new interface field), not a `dotenv-safe` config change.
**Warning signs:** `npm run bot` (or any script calling `loadEnv()`) throwing "не заданы переменные окружения BETA_ALLOWLIST" on a fresh checkout with an intentionally empty allowlist — this is the literal bug D-04 is designed to prevent, so it's a hard verification gate for this phase, not a style nitpick.

### Pitfall 5: `@grammyjs/menu` used outside `conversation.menu()` inside a conversation

**What goes wrong:** `@grammyjs/menu`'s own docs (per its plugin page, referenced but not re-fetched in this session — flagged as `[ASSUMED]` pending direct verification at implementation time) note caveats when a menu registered via plain `bot.use(menu)` is shown *from inside* a conversation, because the menu plugin's middleware and the conversation's replay mechanism are two independent systems that need to be told about each other.
**Why it happens:** Both plugins look like drop-in `bot.use()` middleware individually, but composing them requires the specific `conversation.menu()` integration point (confirmed to exist in the v2 docs fetched above) rather than importing a menu built outside the conversation function.
**How to avoid:** Build onboarding's inline menus (sex, activity, goal, rate presets, timezone) via `conversation.menu()` inside `onboardingConversation`, not as module-level `Menu` instances registered globally — unless the planner decides `waitFor('callback_query:data')` with manually-built `InlineKeyboard` (grammY core, no plugin) is simpler for a linear one-path flow like this, which is a legitimate alternative given none of these menus need dynamic per-render regeneration.
**Warning signs:** Callback taps that appear to do nothing, or that resolve against the wrong `waitFor` in the conversation.
**Confidence:** LOW-MEDIUM — the caveat's existence is well-known in the grammY ecosystem, but this session did not re-fetch `@grammyjs/menu`'s dedicated conversations-interop docs page directly; flagged as an `[ASSUMED]` risk area, not a verified blocker. **Recommendation for the planner:** given this is a strictly linear 7-step flow with no branching menus, consider defaulting to plain `InlineKeyboard` (grammY core) + `conversation.waitFor('callback_query:data')` for the button-based fields (sex, activity, goal, rate, timezone) instead of pulling in `@grammyjs/menu` at all — this sidesteps the interop question entirely and is simpler for a flow with no need for menu re-rendering/pagination. `@grammyjs/menu` earns its complexity in Phase 4 (candidate picker, ±10g adjusters) more than here.

## Code Examples

### Custom Postgres `StorageAdapter` for conversation/session persistence

```typescript
// src/bot/storage/pg-storage-adapter.ts
// Source: interface shape per grammy.dev/ref/core/storageadapter (fetched 2026-08-11)
import type { StorageAdapter } from 'grammy';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';

// Requires a new migration: bot_sessions(key text primary key, value jsonb not null,
// updated_at timestamptz not null default now())
export function createPgStorageAdapter(db: Db): StorageAdapter<string> {
  return {
    async read(key) {
      const rows = await db.execute(sql`select value from bot_sessions where key = ${key}`);
      const row = rows[0] as { value: string } | undefined;
      return row?.value;
    },
    async write(key, value) {
      await db.execute(sql`
        insert into bot_sessions (key, value, updated_at)
        values (${key}, ${value}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()
      `);
    },
    async delete(key) {
      await db.execute(sql`delete from bot_sessions where key = ${key}`);
    },
  };
}
```
**Note:** grammY's `StorageAdapter<T>` is generic; the conversations plugin stores its own internal serialized representation as the value type — confirm the exact `T` (likely `string` after the plugin's own JSON serialization, or the plugin may want `unknown`/a generic slot) against the installed `@grammyjs/conversations` v2.1.1 type definitions at implementation time, since this exact detail was not exhaustively confirmed against the shipped `.d.ts` in this research session (`[ASSUMED]` — the `read`/`write`/`delete` signatures themselves are `[CITED: grammy.dev/ref/core/storageadapter]`, HIGH confidence; the exact generic parameter grammY's session/conversations plugins pass is a smaller, easily-verified-at-write-time detail).

### 409 handling at the entrypoint

See Pitfall 3 above for the full code example — this is the canonical pattern for D-03.

### Allowlist middleware

```typescript
// src/bot/middleware/allowlist.ts
import type { Context, NextFunction } from 'grammy';

export function parseAllowlist(raw: string | undefined): Set<number> {
  if (!raw || raw.trim() === '') return new Set(); // D-04: empty/unset = nobody allowed
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
      .filter((n) => Number.isFinite(n)),
  );
}

export function createAllowlistMiddleware(allowlist: Set<number>) {
  return async (ctx: Context, next: NextFunction) => {
    const id = ctx.from?.id;
    if (id !== undefined && allowlist.has(id)) {
      return next();
    }
    console.log(`отказ: telegram_id=${id ?? 'unknown'}, @${ctx.from?.username ?? '(нет username)'}`);
    await ctx.reply('Бот в закрытой бете. Обратись к владельцу за доступом.');
  };
}
```
`parseAllowlist` is deliberately a pure, exported function — this is the D-08 unit-test seam for the allowlist parsing logic (comma handling, whitespace, non-numeric entries).

### Rate preset inline keyboard (structural cap enforcement, ONBOARD-02)

```typescript
// src/bot/keyboards/onboarding-menus.ts
import { InlineKeyboard } from 'grammy';

// The only 4 values ever offered — exceeding 1 kg/month is not a reachable
// UI state, independent of the domain-layer clamp in calculateTargetCalories
// and the DB check constraint on desired_rate_kg_per_month.
export const RATE_PRESETS_KG_PER_MONTH = [0.25, 0.5, 0.75, 1] as const;

export function buildRateKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const rate of RATE_PRESETS_KG_PER_MONTH) {
    kb.text(`${rate} кг/мес`, `rate:${rate}`).row();
  }
  return kb;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| `@grammyjs/conversations` v1 (`conversation.wait()` only, different persistence model) | v2 (`waitFor`, `external`, documented `StorageAdapter`, `conversation.menu()`) | v2.0.0 released prior to this research (current 2.1.1, published 2025-11-20) | Any v1-era code sample (very common in search results/training data) needs re-verification before use in this phase |

**Deprecated/outdated:** None specific to this phase beyond the v1→v2 conversations API shift noted above.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `@grammyjs/conversations` v2's `StorageAdapter<T>` generic parameter is effectively `string` (or similarly simple) when wired through `session()` for conversation persistence | Code Examples | Low — a TypeScript compile error at implementation time, not a silent runtime bug; easy to fix by checking installed `.d.ts` |
| A2 | `@grammyjs/menu` has a documented interop caveat with `@grammyjs/conversations` that specifically motivates using `conversation.menu()` over a module-level `Menu` | Pitfall 5 | Low-Medium — worst case, wasted implementation time debugging a menu that doesn't resolve inside a `waitFor`; mitigated by this research's own recommendation to consider skipping `@grammyjs/menu` entirely for this phase's linear flow |
| A3 | `conversation.reenter()` exists as a named method for "restart the whole conversation" (used in the ONBOARD-05 code sketch) | Code Examples / Pattern 1 | Low — if it doesn't exist under that name, the same effect is trivially achievable by having the conversation function call itself recursively or by having the command handler call `ctx.conversation.enter('onboarding')` again after exiting; not a design blocker either way |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Where does the pure onboarding-parsing module live — `src/bot/onboarding/` or `src/application/onboarding/`?**
   - What we know: `ARCHITECTURE.md`'s target structure names `application/onboarding-flow.ts` as the eventual home for "collects profile fields, calls domain/nutrition." D-08 only requires the parsing/validation logic to be import-clean of grammY, not a specific folder.
   - What's unclear: Whether Phase 2 should establish the full `application/` layer now, or whether a `src/bot/onboarding/` (co-located, still grammY-free) module is an acceptable interim step given Phase 2 is the very first bot code in the repo.
   - Recommendation: Planner's call — either is consistent with this research; lean toward matching `ARCHITECTURE.md`'s named path (`application/onboarding-flow.ts` or a small `application/onboarding/` folder) since Phase 3 will likely need its own `application/voice-pipeline.ts` next to it anyway, and establishing the pattern now avoids a rename later.

2. **`bot_sessions` table: separate migration in this phase, and does it belong in `src/db/schema/`?**
   - What we know: grammY session/conversation storage needs a durable table; existing schema/migration conventions (Phase 1: 3 separate migrations for extension/schema/RLS, `drizzle-kit generate+migrate`) should be followed.
   - What's unclear: Exact column shape beyond `key`/`value`/`updated_at` (e.g., whether RLS applies here the way it does to `users`/`diary` — probably not needed since this table has no direct end-user-facing read path, but worth a deliberate call).
   - Recommendation: Planner should treat this as a new, small Drizzle schema file (e.g. `src/db/schema/bot-sessions.ts`) + its own generated migration, following the exact Phase 1 pattern already established.

3. **`@grammyjs/menu` vs plain `InlineKeyboard` + `waitFor('callback_query:data')` for this phase's buttons.**
   - What we know: Both are technically capable of the 5 button-based fields (sex, activity, goal, rate, timezone) in a strictly linear flow with no re-rendering/pagination need.
   - What's unclear: Whether `@grammyjs/menu`'s `conversation.menu()` integration is worth the extra dependency/concept for a flow this simple, versus deferring `@grammyjs/menu` to Phase 4 where its stateful re-render behavior (candidate picker, ±10g steppers) actually earns its complexity.
   - Recommendation: Default to plain `InlineKeyboard` (already in grammY core, zero extra dependency) + `conversation.waitFor('callback_query:data')` for Phase 2's linear flow; introduce `@grammyjs/menu` starting Phase 4. This simplifies Phase 2's dependency surface and sidesteps Pitfall 5 entirely. Flagging as an open question rather than baking into Standard Stack because CONTEXT.md's "Claude's Discretion" section explicitly left "framework plumbing" open and STACK.md named `@grammyjs/menu` as a candidate for the correction UX specifically (Phase 4's actual named use case), not onboarding.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | matches `package.json` `engines: >=22` (assumed from prior phase's successful `npm run` scripts; not re-probed this session) | — |
| npm registry access | Installing new grammY packages | ✓ | confirmed live via `npm view` calls in this research session | — |
| Postgres (Supabase) | `bot_sessions` table, `users` writes | ✓ | Already configured and verified in Phase 1 (`check-setup.ts` passes per prior phase completion) | — |
| A real Telegram bot + `TELEGRAM_BOT_TOKEN` | Everything in this phase | ✗ (not yet created — this is new for Phase 2) | — | None — this is a required, blocking setup step for the phase; the plan must include step-by-step BotFather instructions (create bot via @BotFather, get token, add to `.env`) per CLAUDE.md's "owner has no backend experience" rule |

**Missing dependencies with no fallback:**
- `TELEGRAM_BOT_TOKEN` does not exist yet — the plan must include a literal, numbered BotFather walkthrough (open Telegram, message @BotFather, `/newbot`, choose name/username, copy the token, paste into `.env`) as an explicit early task, mirroring the Supabase/OpenAI setup instructions from Phase 1's plans.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (already installed, `npm test` = `vitest run`) |
| Config file | `vitest.config.ts` (exists from Phase 1) |
| Quick run command | `npx vitest run src/bot/onboarding` (or wherever the pure module lands, per Open Question 1) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ONBOARD-01 | `parseAge`/`parseHeight`/`parseWeight` accept valid numbers, reject non-numeric/out-of-range input with a Russian re-prompt string | unit | `npx vitest run src/bot/onboarding/parse-fields.test.ts` | ❌ Wave 0 |
| ONBOARD-01 | `assembleProfile` builds a valid `NutritionProfile` from a complete set of parsed field values | unit | `npx vitest run src/bot/onboarding/assemble-profile.test.ts` | ❌ Wave 0 |
| ONBOARD-01 | End-to-end `/start` → 7 answers → sees targets, in a real Telegram client | manual | manual check-list, item 1 | ❌ Wave 0 (doc to write) |
| ONBOARD-02 | Rate preset buttons never offer >1 kg/month; `RATE_PRESETS_KG_PER_MONTH` constant asserted at exactly `[0.25, 0.5, 0.75, 1]` | unit | `npx vitest run src/bot/keyboards/onboarding-menus.test.ts` | ❌ Wave 0 |
| ONBOARD-02 | Selecting each preset in real Telegram never shows a 5th/higher option | manual | manual check-list, item 2 | ❌ Wave 0 (doc to write) |
| ONBOARD-05 | Confirming persists `onboardedAt`; "заново" restarts without persisting a partial row | manual (DB write is I/O; see Open Question 1 re: whether an integration test against a real/test DB is warranted — D-09 rejects e2e Telegram emulation but does not forbid a direct DB-level integration test of the save function) | manual check-list, item 3 + optionally `npx vitest run src/bot/onboarding/save-user.test.ts` (integration, real test DB) | ❌ Wave 0 |
| ONBOARD-06 | Disclaimer text is present in the confirmation message sent before "подтвердить" is pressed | unit (assert the message-building function's output contains the disclaimer string) + manual (visual check) | `npx vitest run src/bot/formatting/onboarding-copy.test.ts` | ❌ Wave 0 |
| D-03 (409) | `bot.start()` failure with `error_code 409` produces the plain-Russian message, not a raw stack trace | manual only — this is a process-level, two-terminal scenario D-09 explicitly excludes from automation | manual check-list, item 4 | ❌ Wave 0 (doc to write) |
| D-04/D-05 | `parseAllowlist('')` / `parseAllowlist(undefined)` → empty set; `parseAllowlist('123, 456,,abc')` → `{123, 456}` (non-numeric silently dropped, not crashing) | unit | `npx vitest run src/bot/middleware/allowlist.test.ts` | ❌ Wave 0 |
| D-06 | `/whoami` reply contains the caller's numeric ID | manual (or a thin unit test of a pure `formatWhoamiReply(id)` function, if the handler is split that way) | manual check-list, item 5 | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run <touched-file>.test.ts`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green + the manual check-list document fully walked through and signed off (per D-08) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/bot/onboarding/parse-fields.test.ts` (or equivalent path per Open Question 1) — covers ONBOARD-01 field parsing
- [ ] `src/bot/onboarding/assemble-profile.test.ts` — covers ONBOARD-01 profile assembly
- [ ] `src/bot/keyboards/onboarding-menus.test.ts` (or `.../rate-presets.test.ts`) — covers ONBOARD-02
- [ ] `src/bot/middleware/allowlist.test.ts` — covers D-04/D-05
- [ ] `src/bot/formatting/onboarding-copy.test.ts` — covers ONBOARD-06 disclaimer presence
- [ ] `.planning/phases/02-bot-skeleton-onboarding/MANUAL-CHECKLIST.md` (or similar, exact filename per D-08 — a new document, not covered by any existing Wave 0 test infra) — covers the four success criteria's actual-Telegram verification, plus the 409 two-terminal scenario, `/whoami`, and the mid-onboarding-restart replay-safety scenario from Pitfall 2
- [ ] No new test framework/config needed — Vitest is already fully set up from Phase 1

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | Partial | Telegram's own `ctx.from.id` is treated as the identity primitive (standard for Telegram bots — Telegram itself authenticates the user to the bot API); this phase adds no separate credential system |
| V3 Session Management | Yes | grammY `session()` + the custom Postgres `StorageAdapter` — no session tokens are exposed to the client (Telegram handles that layer); this phase's "session" is conversation-flow state only |
| V4 Access Control | Yes | The allowlist middleware (D-04/D-05) — fail-closed on empty config is the correct default per ASVS V4 access-control principles (deny-by-default) |
| V5 Input Validation | Yes | `parseAge`/`parseHeight`/`parseWeight`/`parseAllowlist` — all free-text/config input is parsed through explicit validators before use, never passed through to DB or business logic unchecked |
| V6 Cryptography | No | Nothing in this phase requires new cryptography — `TELEGRAM_BOT_TOKEN` is a bearer secret handled via the existing `.env`/`dotenv-safe` pattern, not a cryptographic primitive Phase 2 implements itself |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Allowlist bypass via malformed/empty `BETA_ALLOWLIST` misread as "allow all" | Elevation of Privilege | D-04's fail-closed design (empty = nobody) + `parseAllowlist` unit tests asserting the empty/malformed cases explicitly, not just the happy path |
| Telegram `update_id` replay causing duplicate `users` inserts during a conversation replay after a crash | Tampering / Repudiation (data integrity) | `conversation.external()` wrapping every DB write (Pitfall 2) + `onConflictDoUpdate` on `telegramId` as defense-in-depth |
| Token/secret leakage via logs (e.g., accidentally logging `TELEGRAM_BOT_TOKEN` or a full connection string) | Information Disclosure | Follow the existing `check-setup.ts` convention of masking connection targets and never printing secret values — the allowlist rejection log (`отказ: telegram_id=...`) intentionally logs only a numeric ID + username, never a token |
| 409-handling code accidentally logging the bot token in a stack trace when rethrowing | Information Disclosure | The recommended `try/catch` in Pitfall 3 logs a fixed, hand-written Russian string on the 409 branch — do not `console.error(err)` the raw error object for this specific branch, since grammY error objects can include request metadata |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view grammy version`, `npm view @grammyjs/conversations version`, `npm view @grammyjs/menu version`, and their `peerDependencies`) — fetched live, 2026-08-11
- https://grammy.dev/plugins/conversations — fetched directly, 2026-08-11 (v2 API: `waitFor`, `external`, storage config, menu integration)
- https://grammy.dev/ref/core/storageadapter — fetched directly, 2026-08-11 (`StorageAdapter<T>` interface)
- https://grammy.dev/guide/deployment-types — fetched directly, 2026-08-11 (polling vs webhook branch pattern)
- https://github.com/grammyjs/grammY (src/bot.ts, via documentation fetch) — 2026-08-11, confirmed `handlePollingError` rethrows on 401/409, retries other errors with backoff

### Secondary (MEDIUM confidence)
- https://grammy.dev/guide/errors — fetched directly, confirms `bot.catch()` scope is middleware errors (`GrammyError`/`HttpError`/`BotError`), but did not itself state the 409/polling distinction as explicitly as the source-code fetch did
- WebSearch cross-reference on grammY 409 handling (multiple community issue threads, e.g. grammyjs/grammY#269, node-telegram-bot-api#550) — corroborates the "getUpdates 409 conflict, single-instance-only" failure mode as a known, common first-week issue across Telegram bot frameworks generally, consistent with D-03's own framing

### Tertiary (LOW confidence)
- `@grammyjs/menu`'s specific documented caveats about conversation interop (Pitfall 5) — not independently re-fetched from the menu plugin's own docs page in this session; flagged in Assumptions Log (A2) for verification at implementation time

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified live against npm registry, peer dependency compatibility checked directly
- Architecture: HIGH — extends the project's own pre-existing `ARCHITECTURE.md`, which was itself researched and validated in a prior phase; the new pieces (StorageAdapter, conversation replay pattern) are sourced from official grammY docs fetched this session
- Pitfalls: HIGH for 409/`bot.catch()` split (verified against grammY source) and the `env.ts`/D-04 interaction (verified by direct code reading); MEDIUM-LOW for the `@grammyjs/menu` interop caveat (not re-verified this session, explicitly flagged)

**Research date:** 2026-08-11
**Valid until:** ~30 days (grammY ecosystem moves at a moderate pace; `@grammyjs/menu` was published 2 days before this research, so re-check `npm outdated` before implementation if this research is used more than a couple weeks later)

---
*Phase: 2-Bot skeleton + onboarding*
*Research completed: 2026-08-11*
