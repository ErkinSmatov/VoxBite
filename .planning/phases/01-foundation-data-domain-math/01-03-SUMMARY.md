---
phase: 01-foundation-data-domain-math
plan: 03
subsystem: data
tags: [drizzle-orm, postgres, pgvector, supabase, rls, migrations]

# Dependency graph
requires: [01-01, 01-02]
provides:
  - Live Postgres schema: users, diary, fdc_foods tables in the real Supabase database
  - Drizzle ORM schema definitions (src/db/schema/*.ts) other plans import for typed queries
  - src/db/client.ts (createDb/closeDb) — the lazy Drizzle client every DB-touching plan reuses
  - Versioned SQL migrations under drizzle/ (generate+migrate workflow, no push)
  - npm run verify-schema — live introspection proof command
affects: [01-06, 01-07, 01-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "drizzle-kit generate + migrate only, never push — every schema change is a reviewable committed SQL file"
    - "Postgres-level check() constraints mirror the TypeScript $type<> unions for sex/activity_level/goal/rate-cap, so invalid data can't enter even via a raw SQL client"
    - "RLS enabled with zero policies = deny-all through Supabase's public PostgREST API; the app's own postgres role (BYPASSRLS) is unaffected"

key-files:
  created:
    - drizzle.config.ts
    - src/db/schema/users.ts
    - src/db/schema/diary.ts
    - src/db/schema/fdc-foods.ts
    - src/db/schema/index.ts
    - src/db/client.ts
    - scripts/verify-schema.ts
    - drizzle/0000_enable_pgvector.sql
    - drizzle/0001_init_schema.sql
    - drizzle/0002_enable_rls.sql
    - drizzle/meta/ (0000-0002 snapshots + _journal.json)
    - .planning/phases/01-foundation-data-domain-math/deferred-items.md
  modified: []

key-decisions:
  - "Migration order: 0000 enables pgvector (idempotent, no-op on Supabase where it's pre-enabled), 0001 creates all three tables, 0002 enables RLS — kept as three separate reviewable files rather than one, so each concern (extension / schema / security) is independently auditable in git history"
  - "verify-schema.ts uses postgres.js's `in ${sql([...])}` IN-list helper, not `= any(sql.array(...))` — the latter sends a bare Postgres array literal that `= any()` rejects with 'op ANY/ALL (array) requires array on right side'"

requirements-completed: [ONBOARD-03, MATCH-01, MATCH-02]

# Metrics
duration: 45min
completed: 2026-08-11
---

# Phase 1 Plan 3: Postgres Data Model (users, diary, fdc_foods) Summary

**Drizzle-defined `users`/`diary`/`fdc_foods` tables — including a real pgvector `vector(1536)` column with an HNSW cosine index and a nullable `sugar_g` — generated as three reviewable SQL migrations and applied to the live Supabase database with RLS enabled on all three tables.**

## What "migration" and "RLS" mean here (for the owner)

A **migration** is just a plain SQL file that describes one change to the
database's structure (e.g. "create this table", "add this column"). Instead
of ever hand-typing SQL into Supabase's dashboard, this project generates
migration files from the TypeScript schema (`src/db/schema/*.ts`) with
`npm run db:generate`, reviews the generated `.sql` file, and only then
applies it with `npm run db:migrate`. Every migration is a committed file
under `drizzle/` — so the exact history of every database change is in git,
reviewable and revertible, not something that only lives inside Supabase.

**RLS** (Row Level Security) is a built-in Postgres feature that Supabase
turns into a security boundary: Supabase automatically exposes every table
in the `public` schema through a public web API (PostgREST), reachable by
anyone who has the project's `anon` key — and that key is meant to be public
(it ships inside client apps). Without RLS, anyone who found the Supabase
project URL could read every user's profile and food diary directly over
HTTP. Turning RLS on with zero access policies means "deny everyone by
default" for that public API, while this project's own bot backend — which
connects using the privileged `postgres` role — keeps full access exactly as
before. No code changes were needed on the app side.

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-11
- **Tasks:** 3 completed
- **Files created:** 12 (7 TS/config files + 3 migration `.sql` files + `drizzle/meta/` + 1 deferred-items log)

## Accomplishments

- `users`, `diary`, `fdc_foods` exist in the live Supabase database, created entirely through `drizzle-kit generate` + `migrate` — `push` was never used
- `fdc_foods.embedding` is a genuine `vector(1536)` column (verified live: `udt_name = 'vector'`, `atttypmod = 1536`) with an `hnsw` + `vector_cosine_ops` index — the precondition MATCH-01's similarity search needs
- `fdc_foods.sugar_g`, `kcal`, `protein_g`, `fat_g`, `carbs_g` are all nullable — verified live via `information_schema.columns`, so "no data" (`нет данных`) stays distinguishable from "0 g" per TECH_SPEC §5.8
- `users` carries Postgres `check` constraints for `sex`, `activity_level` (all 5 TECH_SPEC §6.2 levels), `goal`, and the ONBOARD-02 0..1 kg/month rate ceiling — enforced at the database layer, not only wherever the bot's own UI happens to validate input
- RLS is enabled on all three tables with `anon`/`authenticated` grants revoked; verified live via `pg_class.relrowsecurity`
- `npm run verify-schema` performs 8 live introspection checks and prints `SCHEMA OK` with a plain-language explanation for each — no DATABASE_URL or credential is ever printed
- No `search_path` fix to `DATABASE_URL` was needed — the existing Session Pooler connection string from Plan 02 found the `vector` extension without adjustment

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the Drizzle schema (users, diary, fdc_foods) and the database client** - `1568993` (feat)
2. **Task 2: Write the live schema verification script** - `d788301` (feat)
3. **Task 3: Generate the migrations (pgvector, schema, RLS) and apply them to Supabase** - `dd82051` (feat)

## Migration filenames (exact, in apply order)

1. `drizzle/0000_enable_pgvector.sql` — `CREATE EXTENSION IF NOT EXISTS vector;` (no-op on Supabase, needed for a from-scratch Postgres)
2. `drizzle/0001_init_schema.sql` — `CREATE TABLE users/diary/fdc_foods`, all columns, indexes, FKs, and check constraints
3. `drizzle/0002_enable_rls.sql` — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` for all three tables + conditional `REVOKE` from `anon`/`authenticated`

`drizzle/meta/_journal.json` and the three per-migration snapshot files are committed alongside the SQL — this is versioned source, not build output.

## Exact table/column names for Plans 06, 07, 08

```
fdc_foods: fdc_id (PK, integer) · description (text, NOT NULL) · source (text, NOT NULL,
  'foundation_food'|'sr_legacy_food') · kcal/protein_g/fat_g/carbs_g/sugar_g (real, NULLABLE)
  · embedding (vector(1536), NOT NULL) · dataset_version (text, NOT NULL) ·
  embedding_model_version (text, NOT NULL) · indexed_at (timestamptz, default now())

users: id (PK identity) · telegram_id (bigint, unique) · sex/activity_level/goal (text,
  check-constrained) · age_years/height_cm (integer) · weight_kg (real) ·
  desired_rate_kg_per_month (real, nullable, 0..1) · timezone (text, default 'Asia/Almaty')
  · target_kcal/target_protein_g/target_fat_g/target_carbs_g (integer, nullable) ·
  onboarded_at (timestamptz, nullable) · created_at/updated_at (timestamptz)

diary: id (PK identity) · user_id (FK -> users.id, cascade) · eaten_at (timestamptz) ·
  local_date (date) · description (text) · kcal/protein_g/fat_g/carbs_g/sugar_g (real,
  nullable) · created_at (timestamptz)
```

Import from `src/db/schema/index.ts` (re-exports all three files). Get a
connected Drizzle instance via `createDb()` from `src/db/client.ts`
(lazy — calls `loadEnv()` internally, never opens a connection at import
time); call `closeDb()` when done (e.g. at the end of a one-off script).

## Files Created/Modified

- `drizzle.config.ts` - drizzle-kit config: `dialect: 'postgresql'`, schema path, `out: './drizzle'`, `strict: true`; reads `DATABASE_URL` via `loadEnv()`
- `src/db/schema/users.ts` - onboarding profile table with 4 check constraints
- `src/db/schema/diary.ts` - Phase 4 stub table (per-component rows/draft state deferred)
- `src/db/schema/fdc-foods.ts` - USDA FDC index table with the vector(1536) embedding column and HNSW index
- `src/db/schema/index.ts` - re-exports all three schema files
- `src/db/client.ts` - lazy postgres.js + drizzle-orm/postgres-js client (`createDb`/`closeDb`)
- `scripts/verify-schema.ts` - live introspection proof, 8 checks, `--json` flag, human-readable Russian output
- `drizzle/0000_enable_pgvector.sql`, `0001_init_schema.sql`, `0002_enable_rls.sql` - versioned migrations, applied
- `drizzle/meta/*` - drizzle-kit's own migration bookkeeping (snapshots + journal)
- `.planning/phases/01-foundation-data-domain-math/deferred-items.md` - logs one pre-existing, out-of-scope test failure (see below)

## Decisions Made

**1. Three separate migration files instead of one combined file**
- **Context:** The plan's Task 3 already specified this structure (extension / schema / RLS as separate `generate` invocations)
- **Decision:** Followed the plan exactly — each concern is independently reviewable and revertible in git history
- **Alternatives considered:** None — this was directive, not discretionary

**2. `sql(array)` over `sql.array(array)` for IN-list queries in verify-schema.ts**
- **Context:** `= any(${sql.array([...])})` failed against the live database with `op ANY/ALL (array) requires array on right side` (postgres.js sends `sql.array()` values as a Postgres array *literal*, which the `= any()` operator's parser rejects in this position)
- **Decision:** Switched all three IN-list queries to `in ${sql([...])}`, postgres.js's documented helper for dynamic IN lists
- **Alternatives considered:** `= any($1::text[])` with explicit cast — works but `in ${sql([...])}` is the more idiomatic postgres.js pattern and needed no extra cast

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] verify-schema.ts's IN-list queries used an incompatible postgres.js array-parameter pattern**
- **Found during:** Task 3, running `npm run verify-schema` for the first time against the live database
- **Issue:** `= any(${sql.array([...REQUIRED_TABLES])})` threw `PostgresError: op ANY/ALL (array) requires array on right side` at runtime — a genuine bug in the script written in Task 2, only surfaced once a real Postgres connection was available in Task 3
- **Fix:** Replaced both occurrences with `in ${sql([...REQUIRED_TABLES])}`, postgres.js's supported dynamic IN-list syntax
- **Files modified:** `scripts/verify-schema.ts`
- **Commit:** Folded into `dd82051` (Task 3's commit), since the bug was only discoverable once migrations were live and the fix is inseparable from proving Task 3's "verify-schema exits 0" acceptance criterion

### Out-of-scope, logged not fixed

**2. `src/config/env.test.ts` fails one assertion now that a real `.env` exists**
- **Found during:** Task 1, running `npm test` after adding the new schema files
- **Issue:** The test `loadEnv() throws a named-key, .env.example-referencing error when a required var is missing` deletes `process.env.DATABASE_URL`/`OPENAI_API_KEY` and expects `loadEnv()` to throw — but `loadEnv()` calls `dotenvSafe.config()`, which re-populates those vars from the real repo-root `.env` (created in Plan 01-02), so the test's premise ("no `.env` on disk") no longer holds in this repo and the test fails
- **Why not fixed:** `env.test.ts` is owned by Plan 01-01 and is not among this plan's `files_modified`; the failure pre-dates this plan's changes (reproduced via `git stash` showing nothing to stash) and is unrelated to the database schema work — per the executor scope boundary, only issues directly caused by this task's own changes are auto-fixed
- **Logged to:** `.planning/phases/01-foundation-data-domain-math/deferred-items.md`, with root cause, reproduction, and a suggested fix for whoever picks it up
- **Test count impact:** `npm test` reports 91/92 passing (1 known, logged, pre-existing failure) instead of a clean 92/92

## Known Stubs

- `src/db/schema/diary.ts` is intentionally a stub (columns exist, no per-component/draft-state modeling yet) — this is explicitly scoped to Phase 4 by the plan itself, documented in the file's own header comment, not a gap this plan should have closed.

## Threat Flags

None — the migrations only touch the three tables anticipated in the plan's own `<threat_model>`, and all three STRIDE-registered mitigations (RLS/T-01-10, generate+migrate-only/T-01-11, check constraints/T-01-12, no-secret-logging/T-01-04, migrations journal/T-01-13) were implemented exactly as specified.

## Issues Encountered

None beyond the two deviations documented above.

## Self-Check: PASSED

- FOUND: drizzle.config.ts, src/db/schema/users.ts, src/db/schema/diary.ts, src/db/schema/fdc-foods.ts, src/db/schema/index.ts, src/db/client.ts, scripts/verify-schema.ts, drizzle/0000_enable_pgvector.sql, drizzle/0001_init_schema.sql, drizzle/0002_enable_rls.sql, drizzle/meta/_journal.json
- FOUND commits 1568993, d788301, dd82051 in `git log --oneline`
- `npm run verify-schema` exits 0 and prints `SCHEMA OK` (live, re-verified)
- `npx tsc --noEmit` exits 0
- `npm test`: 91/92 passing (1 pre-existing, logged, out-of-scope failure — see Deviations)
