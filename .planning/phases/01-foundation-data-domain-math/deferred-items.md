# Deferred Items — Phase 1

Issues discovered during execution that are out of scope for the current
plan's files (per executor scope-boundary rules) and therefore not
auto-fixed.

## 1. `src/config/env.test.ts` — "missing required key" test fails once a real `.env` exists

- **Discovered during:** Plan 01-03, Task 1 (running `npm test` after adding db schema files)
- **File:** `src/config/env.test.ts` (owned by Plan 01, not touched by Plan 03)
- **Symptom:** The test `loadEnv() throws a named-key, .env.example-referencing
  error when a required var is missing` fails. It deletes
  `process.env.DATABASE_URL`/`OPENAI_API_KEY`, then expects `loadEnv()` to
  throw. But `loadEnv()` calls `dotenvSafe.config()`, which — now that a real
  `.env` file exists at the repo root (created in Plan 01-02) — re-populates
  `process.env.DATABASE_URL` and `OPENAI_API_KEY` from disk, so `loadEnv()`
  no longer throws and the test fails.
- **Root cause:** The test was written and verified before `.env` existed
  (Plan 01-02 created it after Plan 01-01). It implicitly assumed
  `dotenv-safe` would find no `.env` file to read from.
- **Reproduction:** `npx vitest run src/config/env.test.ts` fails 1/5 tests,
  reproducible in isolation, unrelated to any Plan 03 change (confirmed via
  `git stash` showing no local changes were needed to reproduce it).
- **Suggested fix (not applied — out of scope for Plan 03):** Either mock/stub
  the `.env` file path passed to `dotenvSafe.config()` in this test, or have
  the test temporarily rename/hide the repo-root `.env` for the duration of
  this one assertion, or restructure `loadEnv()` to accept an injectable
  config source for testability.
- **Impact:** Low — production behavior of `loadEnv()` is correct; only the
  test's assumption about "no .env on disk" is now false in this repo. Does
  not affect Plan 03's own tables/migrations/verification.
