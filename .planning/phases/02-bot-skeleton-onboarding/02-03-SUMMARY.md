---
phase: 02-bot-skeleton-onboarding
plan: 03
subsystem: data
tags: [drizzle-orm, postgres, rls, migrations, grammy-sessions]

# Dependency graph
requires: [01-03]
provides:
  - src/db/schema/bot-sessions.ts — Drizzle definition of the bot_sessions key/value table
  - Two applied, reviewed SQL migrations (drizzle/0003_grey_anthem.sql,
    drizzle/0004_bot_sessions_rls.sql) that created and locked down bot_sessions
    in the live Supabase database
  - Extended npm run verify-schema covering four tables instead of three
affects: [02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "grammY session/conversation storage is a plain jsonb key/value table, never interpreted by application code — this project's persistence layer for conversation state per ARCHITECTURE.md Anti-Pattern 3"

key-files:
  created:
    - src/db/schema/bot-sessions.ts
    - drizzle/0003_grey_anthem.sql
    - drizzle/0004_bot_sessions_rls.sql
  modified:
    - src/db/schema/index.ts
    - scripts/verify-schema.ts
    - drizzle/meta/_journal.json
    - drizzle/meta/0003_snapshot.json (drizzle-kit generated)

key-decisions:
  - "Kept drizzle-kit's auto-generated filename drizzle/0003_grey_anthem.sql as-is rather than renaming to the plan's placeholder 0003_bot_sessions.sql — the plan explicitly instructs recording the real generated filename instead of the placeholder when drizzle-kit picks a random slug"
  - "Created a temporary, gitignored, placeholder-value .env (from .env.example) solely so drizzle-kit generate could load drizzle.config.ts — db:generate only diffs local schema files, it never opens a database connection, so no real credentials were needed or used; the file was deleted again after Task 2 and never touched the live database"

requirements-completed: [ONBOARD-01, ONBOARD-05]

# Metrics
duration: ~3 sessions (Tasks 1-2 same day, Task 3 resumed after owner approval same day)
completed: 2026-08-11
---

# Phase 2 Plan 3: bot_sessions table (Drizzle schema + reviewable migrations) Summary

**Drizzle-defined `bot_sessions` key/value table for grammY session/conversation persistence, created in the live Supabase database via a reviewed, drizzle-kit-generated `CREATE TABLE` migration plus a hand-written RLS lockdown migration — both read and approved by the owner before `npm run db:migrate` ran, and proven present with RLS enabled by `npm run verify-schema` against the live database.**

## Checkpoint Status

Task 3 was `type="checkpoint:human-verify" gate="blocking"`. Both migration SQL
files were presented to the owner in full; the owner reviewed them and
responded "применяй" (apply it), explicitly approving the change against the
real Supabase database. `npm run db:migrate` then `npm run verify-schema` were
run in that order, per the plan's `<how-to-verify>` instructions. Neither
`drizzle-kit push` nor any destructive SQL was used at any point.

## Performance

- **Duration:** full plan (Tasks 1-3)
- **Completed:** 2026-08-11
- **Tasks:** 3 of 3 completed
- **Files created:** 3 new files (bot-sessions.ts, two migration SQL files) + drizzle-kit's own snapshot bookkeeping

## Accomplishments

- `src/db/schema/bot-sessions.ts` defines `bot_sessions` exactly per the plan's `<interfaces>` contract: `key` (text PK, grammY session key), `value` (jsonb, not null, opaque plugin-owned blob), `updated_at` (timestamptz, default now, not null)
- `src/db/schema/index.ts` barrel re-exports `bot-sessions` as its fourth line
- `scripts/verify-schema.ts`'s `REQUIRED_TABLES` now includes `bot_sessions`, and both hardcoded "three tables" success strings were generalized to derive from `REQUIRED_TABLES.length`/`.join(', ')`
- `npm run db:generate` produced `drizzle/0003_grey_anthem.sql` (drizzle-kit's own auto-slug — note the real filename is NOT the plan's placeholder `0003_bot_sessions.sql`) containing exactly one `CREATE TABLE "bot_sessions"` with the three expected columns and zero `DROP` statements or references to `users`/`diary`/`fdc_foods`
- `drizzle/0004_bot_sessions_rls.sql` was hand-written against `drizzle/0002_enable_rls.sql`'s pattern: enables RLS on `bot_sessions`, includes the `pg_roles`-guarded `REVOKE ALL ... FROM anon, authenticated` no-op-safe block
- `drizzle/meta/_journal.json` registers both `0003_grey_anthem` and `0004_bot_sessions_rls`
- Owner reviewed both SQL files and approved with "применяй"
- `npm run db:migrate` applied both migrations to the live Supabase database successfully (`[✓] migrations applied successfully!`); the driver logged two expected/benign NOTICEs (`schema "drizzle" already exists, skipping` and `relation "__drizzle_migrations" already exists, skipping`) from prior Phase 1 migration runs — not errors
- `npm run verify-schema` confirms against the live database: `[ok] Таблицы существуют — users, diary, fdc_foods, bot_sessions — все 4 таблиц(ы) найдены в схеме public`, `[ok] Row Level Security (RLS) включён — users, diary, fdc_foods, bot_sessions защищены от чтения через публичный Supabase API (anon-ключ)`, plus all pre-existing Phase 1 checks (migration journal, embedding dimensionality, NOT NULL constraints, HNSW index, CHECK constraints) still `[ok]` — zero `[FAIL]` lines, final line `SCHEMA OK`
- `npx tsc --noEmit` exits 0; `npm test` — 255/255 passing (17 test files)
- `drizzle-kit push` was never invoked at any point in this plan

## Task Commits

1. **Task 1: bot_sessions Drizzle schema, barrel export, and verify-schema coverage** - `056d9ae` (feat)
2. **Task 2: Generate the migration SQL and hand-write the RLS lockdown** - `7c99c36` (feat)
3. **Interim SUMMARY.md documenting checkpoint pause** - `e8ce483` (docs)
4. **Task 3: Apply migration to live database and prove via verify-schema** - see final metadata commit for this SUMMARY rewrite

## Exact migration filenames (in apply order)

1. `drizzle/0003_grey_anthem.sql` — generated by `drizzle-kit generate`; `CREATE TABLE "bot_sessions" ("key" text PRIMARY KEY NOT NULL, "value" jsonb NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);` — applied
2. `drizzle/0004_bot_sessions_rls.sql` — hand-written; `ALTER TABLE "bot_sessions" ENABLE ROW LEVEL SECURITY;` plus the guarded `REVOKE ALL ... FROM anon, authenticated` block — applied

## Files Created/Modified

- `src/db/schema/bot-sessions.ts` - new: grammY session/conversation persistence table, RLS-protected key/value store
- `src/db/schema/index.ts` - modified: appended `export * from './bot-sessions';` as the fourth barrel line
- `scripts/verify-schema.ts` - modified: `REQUIRED_TABLES` extended to `['users', 'diary', 'fdc_foods', 'bot_sessions']`; success-message strings generalized instead of hardcoding "three tables"
- `drizzle/0003_grey_anthem.sql` - new: generated `CREATE TABLE bot_sessions`, applied to live database
- `drizzle/0004_bot_sessions_rls.sql` - new: hand-written RLS lockdown for `bot_sessions`, applied to live database
- `drizzle/meta/_journal.json` - modified: registers both new migration tags
- `drizzle/meta/0003_snapshot.json` - new: drizzle-kit's own schema snapshot bookkeeping for the generate step

## Decisions Made

**1. Kept the drizzle-kit-generated random slug filename instead of renaming to the plan's placeholder**
- **Context:** The plan's `files_modified` frontmatter lists `drizzle/0003_bot_sessions.sql` as a placeholder, but Task 2's own `<action>` explicitly says: "if drizzle-kit picks a random slug, that is fine — record the real filename in the SUMMARY and use it everywhere below instead of the placeholder name"
- **Decision:** Left the file as `drizzle/0003_grey_anthem.sql`, exactly as `drizzle-kit generate` produced it, and used that real name in the journal, verification, and this Summary
- **Alternatives considered:** Renaming the file to match the placeholder — rejected because it would desynchronize the filename from the journal tag drizzle-kit itself wrote, and the plan explicitly anticipates and permits the random-slug case

**2. Used a temporary, gitignored, placeholder-value `.env` to run `drizzle-kit generate`**
- **Context:** `drizzle.config.ts` eagerly calls `loadEnv()` for `dbCredentials.url`, which throws if `.env` is absent — even though `drizzle-kit generate` only diffs local TypeScript schema files against the stored snapshot and never opens a database connection
- **Decision:** Copied `.env.example` to `.env` (placeholder values) purely to satisfy config loading, ran `db:generate`, then deleted `.env` again immediately after Task 2 completed. `.env` is in `.gitignore` and was never committed
- **Alternatives considered:** None safer — `drizzle-kit generate`'s CLI does not offer a flag to skip `dbCredentials` resolution when only generating

## Deviations from Plan

None — all three tasks executed exactly as specified, including the blocking human-review checkpoint before the migration touched the live database.

## Known Stubs

None.

## Threat Flags

None — the migrations only touch `bot_sessions`, exactly the surface anticipated in the plan's own `<threat_model>` (T-02-08, T-02-09, T-02-10), and `npm run verify-schema` confirms both mitigations (RLS enabled, migration-journal-tracked schema) are live in the real database.

## Issues Encountered

None. The two NOTICE-level log lines during `db:migrate` (`schema "drizzle" already exists, skipping` and `relation "__drizzle_migrations" already exists, skipping`) are expected idempotent behavior from Postgres, not errors — they occur because the `drizzle` bookkeeping schema was already created by Phase 1's earlier migrations.

## Self-Check: PASSED

- FOUND: src/db/schema/bot-sessions.ts
- FOUND: drizzle/0003_grey_anthem.sql
- FOUND: drizzle/0004_bot_sessions_rls.sql
- FOUND commit 056d9ae in `git log --oneline`
- FOUND commit 7c99c36 in `git log --oneline`
- FOUND commit e8ce483 in `git log --oneline`
- `npx tsc --noEmit` exits 0
- `npm test`: 255/255 passing
- `npm run verify-schema`: `bot_sessions` present, RLS enabled, zero `[FAIL]` lines, `SCHEMA OK`
- `bot_sessions` confirmed present in the live Supabase database
