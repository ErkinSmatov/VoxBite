---
phase: 02-bot-skeleton-onboarding
plan: 04
subsystem: infra
tags: [grammy, telegram, postgres, drizzle-orm, storage-adapter, allowlist, vitest, tdd]

# Dependency graph
requires:
  - phase: 02-bot-skeleton-onboarding
    provides: "Plan 01 (grammY + conversations installed, TELEGRAM_BOT_TOKEN/BETA_ALLOWLIST in loadEnv()), Plan 03 (bot_sessions table live in Supabase with RLS)"
provides:
  - "createPgStorageAdapter<T>(db) — grammY StorageAdapter over bot_sessions, shared by session() and the conversations plugin"
  - "parseAllowlist()/createAllowlistMiddleware() — fail-closed closed-beta gate, first bot.use() call"
  - "createBot(deps) — transport-agnostic composition root (src/bot/bot.ts) registering allowlist -> session -> conversations -> /whoami -> bot.catch"
  - "npm run bot entrypoint (src/bot/index.ts) — the only bot.start() call, converts 409/401/HttpError into plain-Russian instructions, closes the DB pool on SIGINT/SIGTERM"
affects: [02-05, 02-06, 02-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook seam is a file boundary (bot.ts registers handlers and returns an unstarted Bot; index.ts is the only bot.start() call), not an env var — Phase 3 adds a webhook entrypoint next to index.ts without touching bot.ts"
    - "grammY error objects can carry the token in request metadata — index.ts never passes a caught error object whole to console.error, only fixed Russian strings and err.message"
    - "Allowlist middleware is the first bot.use() call, before session()/conversations() — a rejected update never triggers a Postgres round-trip"

key-files:
  created:
    - src/bot/storage/pg-storage-adapter.ts
    - src/bot/storage/pg-storage-adapter.test.ts
    - src/bot/middleware/allowlist.ts
    - src/bot/middleware/allowlist.test.ts
    - src/bot/commands/whoami.ts
    - src/bot/bot.ts
    - src/bot/index.ts
  modified: []

key-decisions:
  - "createAllowlistMiddleware returns grammY's MiddlewareFn<Context> (not the broader Middleware<Context> union in the plan's <interfaces> block) — Middleware<Context> includes MiddlewareObj, which has no call signature and made the middleware non-callable under tsc; MiddlewareFn<Context> is a subtype and still satisfies bot.use()"
  - "pg-storage-adapter.test.ts mocks drizzle-orm's eq() to return a plain { key: value } object so a hand-written fake db can assert on it without opening a real Postgres connection — matches the plan's explicit requirement that the unit test open no database connection"

patterns-established:
  - "First bot.use() is always the allowlist gate — any future middleware must be added after it, never before (D-05)"

requirements-completed: [ONBOARD-01]

# Metrics
duration: ~35min
completed: 2026-08-11
---

# Phase 2 Plan 4: Bot Process, Storage, Allowlist Gate Summary

**A running `npm run bot` process: fail-closed allowlist gate as the first middleware, grammY session/conversation state persisted in Postgres via `bot_sessions`, `/whoami` for the owner, and 409/401/no-internet failure modes converted into plain-Russian instructions with the token never printed.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-11T22:20:00+05:00 (approx)
- **Completed:** 2026-08-11T22:30:00+05:00 (approx)
- **Tasks:** 3 (Task 1 TDD, Task 2 TDD, Task 3 auto)
- **Files modified:** 7 created, 0 modified

## Accomplishments

- `createPgStorageAdapter<T>(db)` implements grammY's real `StorageAdapter<T>` port (confirmed against the installed `.d.ts`, not assumed) over `bot_sessions`, using the Drizzle query builder exclusively (`select().from().where(eq(...))`, `insert().values().onConflictDoUpdate()`, `delete().where(...)`) — no raw SQL, no logging of the stored value
- The same adapter instance shape is reused for both grammY's `session()` middleware and `@grammyjs/conversations`' `conversations({ storage: { type: 'key', adapter: ... } })` — one durable home for both session data and conversation replay state (Anti-Pattern 3)
- `parseAllowlist()` is a pure function: empty/unset/whitespace-only input returns an empty `Set` (D-04, fail-closed), malformed entries (negative, zero, decimal, non-numeric, `NaN`, `Infinity`) are silently dropped rather than becoming permissive `NaN` holes, and Telegram IDs above the 32-bit range round-trip correctly
- `createAllowlistMiddleware()` is the first `bot.use()` registered in `bot.ts` — a rejected update never reaches session storage or a handler; every rejection logs exactly one `отказ: telegram_id=<id>, @<username>` line (the owner's actual ID-discovery mechanism) and sends one polite Russian reply
- `bot.ts` is a pure composition root: it takes `{ db, token, allowlist }` via `BotDeps`, never calls `loadEnv()`/`createDb()`/`bot.start()`, and registers middleware in the load-bearing order allowlist → session → conversations → `/whoami` → `bot.catch`
- `index.ts` is the sole `bot.start()` call: prints an owner-facing status block (allowlist size, and the full first-run empty-allowlist walkthrough when it's empty), and catches `GrammyError` (409 → "уже запущен в другом терминале", 401 → "проверь TELEGRAM_BOT_TOKEN") and `HttpError` (no internet) with fixed Russian strings, **never** passing the raw error object to `console.error`
- SIGINT/SIGTERM handlers call `bot.stop()` then `closeDb()` so Ctrl+C does not leave a Postgres connection hanging; the same `closeDb()` runs on every error exit path

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD): Postgres StorageAdapter over bot_sessions** - `a897abb` (test, RED) → `b272e6f` (feat, GREEN)
2. **Task 2 (TDD): Fail-closed allowlist parsing and gate middleware** - `4fa4681` (test, RED) → `a7c70c9` (feat, GREEN)
3. **Task 3: Transport-agnostic bot composition + npm run bot entrypoint** - `94260c4` (feat)

**Plan metadata:** committed together with this SUMMARY (see final commit)

_No refactor commits were needed on either TDD task — GREEN implementations matched the target shape on the first pass._

## Files Created/Modified

- `src/bot/storage/pg-storage-adapter.ts` - `createPgStorageAdapter<T>(db)`, grammY `StorageAdapter<T>` over `bot_sessions`, Drizzle builder only
- `src/bot/storage/pg-storage-adapter.test.ts` - 6 cases, hermetic fake `db` + mocked `eq()`, opens no real DB connection
- `src/bot/middleware/allowlist.ts` - `parseAllowlist()` and `createAllowlistMiddleware()`, fail-closed by construction
- `src/bot/middleware/allowlist.test.ts` - 18 cases covering parse edge cases, next()-call behavior, the exact `отказ:` log line, and the undefined-`ctx.from` case
- `src/bot/commands/whoami.ts` - thin handler, no DB access, replies with the caller's own numeric ID
- `src/bot/bot.ts` - `createBot(deps)` composition root; registers allowlist → session → conversations → `/whoami` → `bot.catch`; never starts the bot or touches env/DB directly
- `src/bot/index.ts` - `npm run bot` entrypoint; the only `bot.start()` call; 409/401/HttpError handling; SIGINT/SIGTERM cleanup; `import.meta.url` guard so importing this file never starts polling

## Decisions Made

**1. `createAllowlistMiddleware` returns `MiddlewareFn<Context>`, not the plan interface's literal `Middleware<Context>`**
- **Context:** `Middleware<C>` in grammY is `MiddlewareFn<C> | MiddlewareObj<C>`; `MiddlewareObj` has no call signature, so a function typed to return the full union failed `npx tsc --noEmit` when the test file invoked it directly as `middleware(ctx, next)`
- **Decision:** Narrowed the return type to `MiddlewareFn<Context>`, which is assignable everywhere `Middleware<Context>` is expected (`bot.use()` accepts it) and is directly callable in tests
- **Alternatives considered:** Casting at every call site — rejected as noise; the plan's `<interfaces>` block names the type for documentation purposes, and the concrete, more specific type is a strict improvement, not a deviation from the actual contract

**2. `pg-storage-adapter.test.ts` mocks `drizzle-orm`'s `eq()`**
- **Context:** The plan requires this test to open no database connection while still asserting the adapter targets `botSessions.key` via `onConflictDoUpdate`. Real `eq()` returns an opaque SQL fragment not meant for test-side inspection
- **Decision:** `vi.mock('drizzle-orm', ...)` replaces only `eq` with a `{ key: value }` stand-in; the hand-written fake `db` reads that shape to simulate row storage. `onConflictDoUpdate`'s `target` argument is still asserted against the real `botSessions.key` column object, so the "targets the right column" claim is verified without touching Postgres

## Deviations from Plan

None beyond the two decisions above (both within Rule 1/normal implementation judgment, not architectural changes) — all three tasks, their `<behavior>`/`<action>` specs, and every `<acceptance_criteria>` line were implemented as written.

## Known Stubs

None — every exported function is fully wired; `/start` intentionally has no handler yet (Plan 06's job), and this is documented in `bot.ts`'s own comments so it doesn't read as a bug.

## Threat Flags

None — all four `<threat_model>` entries (T-02-11 through T-02-15) are the exact surfaces implemented and covered by the automated verify checks in this plan; no new surface was introduced beyond what the plan anticipated.

## Issues Encountered

None blocking. One incidental observation during the two-terminal 409 manual smoke test: Telegram's long-polling conflict resolution let the *second* process become the active poller and 409'd the *first* (older) process, rather than the other way around — this is expected Telegram Bot API behavior (whichever `getUpdates` call is currently blocked gets displaced by a newer one), not a bug in `index.ts`. The catching/reporting behavior itself (fixed Russian string, exit 1, no stack trace, no token) worked correctly on the process that received the 409.

## Manual Smoke Test Results (recorded per plan's `<output>` instructions)

**Empty-allowlist start** (`BETA_ALLOWLIST=` in `.env`, unchanged from Plan 01):
```
Список допущенных telegram_id (BETA_ALLOWLIST): 0 шт.
BETA_ALLOWLIST пуст — это ожидаемо при первом запуске. Пока список пуст, бот не пустит НИКОГО, даже владельца — это правильное поведение "закрыто по умолчанию" (D-04).
Как открыть себе доступ:
1. Оставь бота запущенным (или запусти сейчас).
2. Отправь боту любое сообщение (например /start) со своего Telegram-аккаунта.
3. В этом терминале появится строка вида "отказ: telegram_id=123456789, @username" — скопируй число.
4. Впиши это число в BETA_ALLOWLIST в файле .env, например BETA_ALLOWLIST=123456789
5. Останови бота (Ctrl+C) и запусти снова командой npm run bot.
Бот запущен: @voxbite_bot. Останови его сочетанием Ctrl+C.
```
(The `отказ:` line itself was exercised via the 18-case unit test suite, not via a live Telegram `/start` message, to avoid leaving a long-polling process running unattended during this session — the exact log format is asserted literally in `allowlist.test.ts`.)

**Two-terminal 409 test** — first terminal's verbatim output after the second process started:
```
Бот запущен: @voxbite_bot. Останови его сочетанием Ctrl+C.
Похоже, бот уже запущен в другом терминале — закрой его и запусти снова.
Только один процесс может использовать один токен одновременно.
```
No stack trace, no token, in either terminal's output. Both processes and the second (surviving) poller were confirmed stopped after the test (`ps aux` showed zero `tsx src/bot/index.ts` processes remaining).

**Ctrl+C clean shutdown** — `SIGINT` produced `\nОстанавливаю бота...` followed by clean process exit (confirmed via `ps aux`), no unhandled-rejection output.

## User Setup Required

None — `TELEGRAM_BOT_TOKEN` and `BETA_ALLOWLIST` were already set up in Plan 01; this plan required no new environment variables or dashboard configuration.

## Next Phase Readiness

- `npm run bot` runs a real, closed-by-default bot; `createBot()`'s registration order is ready for Plan 06 to add `bot.command('start', ...)` and `createConversation(...)` without touching the allowlist/session/conversations ordering
- The Postgres-backed storage adapter is shared and ready for the onboarding conversation's multi-step state (Plan 06)
- The webhook seam (`bot.ts` vs `index.ts`) is in place for Phase 3 to add a webhook entrypoint as a new file, not a rewrite

---

*Phase: 02-bot-skeleton-onboarding*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 7 referenced source files and this SUMMARY were confirmed present on disk; all 5 task commit hashes (`a897abb`, `b272e6f`, `4fa4681`, `a7c70c9`, `94260c4`) and this SUMMARY's own commit (`1db8fe1`) were confirmed present in `git log --oneline --all`.
