---
phase: 01-foundation-data-domain-math
plan: 01
subsystem: infra
tags: [nodejs, typescript, vitest, dotenv-safe, drizzle-orm, postgres.js, openai, secret-hygiene]

# Dependency graph
requires: []
provides:
  - Pinned Node 22 / TypeScript 5.9 project skeleton with strict tsconfig
  - Vitest test infrastructure (node environment, globals off)
  - Lazy fail-fast env loader (src/config/env.ts: loadEnv, REQUIRED_ENV_KEYS, AppEnv)
  - Supabase Postgres + OpenAI connectivity check script (npm run check-setup)
  - Secret hygiene: .gitignore excludes .env, .env.example tracked with placeholders only
affects: [01-02, 01-05, 01-06, 01-07, 01-08]

# Tech tracking
tech-stack:
  added: [drizzle-orm@0.45.2, postgres@3.4.9 (postgres.js driver), openai@7.4.0, csv-parse@7.0.2, dotenv-safe@9.1.0, drizzle-kit@0.31.10, vitest@4.1.10, tsx@4.23.12, typescript@5.9.3]
  patterns:
    - "Lazy env loading: env vars are read only inside loadEnv(), never at module import time, so importing config-dependent modules never crashes a machine with no .env"
    - "Postgres driver = postgres.js (not pg) + drizzle-orm/postgres-js, matching Supabase's own Drizzle guide"

key-files:
  created:
    - package.json
    - package-lock.json
    - tsconfig.json
    - vitest.config.ts
    - .gitignore
    - .env.example
    - src/config/env.ts
    - src/config/env.test.ts
    - scripts/check-setup.ts
  modified: []

key-decisions:
  - "Postgres driver: postgres.js (postgres@3.4.9) + drizzle-orm/postgres-js, per plan's driver decision — handles Supabase pooler TLS from ?sslmode=require without extra cert config"
  - "dotenv-safe is invoked exactly once, inside loadEnv(), never at module top level, to keep import-time behavior safe on machines without .env"

patterns-established:
  - "Task-scoped npm scripts declared once in package.json even for files created by later plans, so package.json stays owned by this plan only"

requirements-completed: [ONBOARD-03, ONBOARD-04, MATCH-01, MATCH-02]

# Metrics
duration: 20min
completed: 2026-08-11
---

# Phase 1 Plan 01: Project Scaffolding Summary

**Greenfield Node 22 + TypeScript project with pinned dependencies, strict typechecking, Vitest test infra, a lazy fail-fast env loader, and a Supabase/OpenAI connectivity-check script — all other Phase 1 plans build on this.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-11
- **Tasks:** 3 completed
- **Files modified:** 9

## Accomplishments
- `npm test` and `npm run typecheck` both pass cleanly (5 Vitest tests, 0 TS errors)
- `.env` is unignorable-by-accident; `.env.example` documents both required keys with plain-language, first-time-backend-dev instructions on where to get each value
- `src/config/env.ts` proves import-time safety with no `.env` present while `loadEnv()` fails fast with a named-key, `.env.example`-referencing error message when misconfigured
- `npm run check-setup` exists, typechecks, never logs secret values, and is ready to serve as the verification command for Plan 02's owner-facing setup checkpoints

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize the Node/TypeScript project with pinned dependencies and secret hygiene** - `d82a3f6` (feat)
2. **Task 2: Add Vitest config and the lazy fail-fast env loader** - `53fcd52` (test, RED) then `67ee5ff` (feat, GREEN)
3. **Task 3: Write the Supabase + OpenAI connectivity check script** - `42461a5` (feat)

_Note: Task 2 used TDD — a `test(...)` commit with all 5 tests failing (module did not exist) was made before the `feat(...)` commit that made all 5 pass._

## Files Created/Modified
- `package.json` - Project manifest: type module, engines node>=22, all 11 phase npm scripts, pinned exact dependency versions
- `package-lock.json` - Lockfile for reproducible installs
- `tsconfig.json` - Strict TS config (`strict`, `noUncheckedIndexedAccess`) covering src/ and scripts/
- `vitest.config.ts` - Node-environment Vitest config, globals off, covers `src/**/*.test.ts` and `scripts/**/*.test.ts`
- `.gitignore` - Excludes `.env`/`.env.*` with `!.env.example` negation, `node_modules/`, `dist/`, `coverage/`, `data/`, `*.log`, `.DS_Store`; `drizzle/` intentionally NOT ignored (migrations are versioned source)
- `.env.example` - Tracked template with `DATABASE_URL` (Supabase Session pooler) and `OPENAI_API_KEY`, each with plain-language sourcing instructions
- `src/config/env.ts` - `loadEnv()`, `REQUIRED_ENV_KEYS`, `AppEnv`, `resetEnvCacheForTests()` (test-only) — the sole call site for dotenv-safe
- `src/config/env.test.ts` - 5 tests covering import-safety, key parity with `.env.example`, caching, missing-key error message, and successful load
- `scripts/check-setup.ts` - `npm run check-setup`: verifies Postgres connectivity + pgvector extension + a 1536-dim OpenAI embeddings call; `--db-only`/`--openai-only` flags; masks all secret values in output

## Decisions Made

**1. Postgres driver: postgres.js over pg**
- **Context:** Plan's `<interfaces>` section specified this as Claude's discretion, with a stated rationale (Supabase's own Drizzle guide, TLS handling for the pooler)
- **Decision:** Installed `postgres@3.4.9` + used with `drizzle-orm/postgres-js`; did not install `pg`/`@types/pg`
- **Alternatives considered:** `pg` — explicitly excluded per plan's interface contract

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria for all 3 tasks were verified directly (package.json scripts/deps, tsconfig strict flags, gitignore behavior for `.env`/`.env.example`/`data/`/`drizzle/`, Vitest pass count, typecheck, check-setup script's static-content and secret-non-logging checks, and the no-`.env`-present exit-1 remediation flow).

## Known Stubs

None. All three tasks produce fully functional code with no placeholder/mock data paths. `scripts/check-setup.ts` genuinely calls live Postgres and OpenAI APIs when `.env` is configured (this is intentional per the plan — it is a connectivity check, not a stub).

## Issues Encountered

- `npm audit` reports 4 moderate-severity advisories against `drizzle-kit@0.31.10`'s bundled dev-time `esbuild` (dev server request-forwarding issue, not exploitable in production/CI usage). Fixing would require downgrading `drizzle-kit` to `0.18.1`, contradicting the plan's pinned version (`drizzle-kit@0.31.10`). Left as-is — out of scope for this task per the plan's explicit version pin; flagged here for visibility, not auto-fixed under Rule 1 because remediation directly conflicts with an explicit plan requirement.

## Self-Check: PASSED

- FOUND: package.json, package-lock.json, tsconfig.json, vitest.config.ts, .gitignore, .env.example, src/config/env.ts, src/config/env.test.ts, scripts/check-setup.ts
- FOUND commit d82a3f6, 53fcd52, 67ee5ff, 42461a5 in `git log --oneline`
- `npm test` exits 0 (5/5 passing), `npm run typecheck` exits 0
