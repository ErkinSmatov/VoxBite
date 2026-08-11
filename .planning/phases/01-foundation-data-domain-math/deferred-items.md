# Deferred Items — Phase 1

Issues discovered during execution that are out of scope for the current
plan's files (per executor scope-boundary rules) and therefore not
auto-fixed.

## 1. ~~`src/config/env.test.ts` — "missing required key" test fails once a real `.env` exists~~ — RESOLVED

**Status: RESOLVED by the orchestrator at the post-Wave-3 integration gate.**
Fixed by stubbing `dotenv-safe` with `vi.mock` at the top of
`src/config/env.test.ts`, so `loadEnv()`'s validation is exercised against a
`process.env` each test controls explicitly, with no disk read. Verified
92/92 passing both with `.env` present and with it temporarily moved aside —
the suite is now machine-state-independent. Production code was not changed.

Original report retained below for the record.


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

## 2. Residual `verify-matches` retrieval-quality noise — carried to Phase 4

**Status: ACCEPTED, deferred to Phase 4 (candidate-correction UX). Not fixed
in Plan 01-08 — out of scope for this phase per 01-RESEARCH.md Pitfall 6 and
the plan's own checkpoint decision.**

- **Discovered during:** Plan 01-08, Task 3 checkpoint (owner review of
  `npm run verify-matches` output on `text-embedding-3-large@1536`, after the
  white-rice/brown-rice fix).
- **Item 2a — "chicken egg" regression:** Rank 1 is now `Bread, egg`
  (fdcId 172673), pushing the real egg (`Egg, whole, raw, fresh`, fdcId
  171287) to rank 2. On the previous model (`text-embedding-3-small`) all
  three candidates for this query were eggs. This is a genuine regression
  introduced by the model switch, traded off against the white-rice/brown-rice
  fix the switch was made for. Since the user always confirms/corrects the
  matched ingredient manually before it's saved (TECH_SPEC §5.6, a hard
  product requirement), "correct candidate at rank 2, not rank 1" is judged
  acceptable rather than blocking, but Phase 4's picker UX must make rank-2/3
  selection easy and low-friction, not an edge case.
- **Item 2b — "banana" noise:** Rank 2 candidate is `Melon, banana (Navajo)`
  (fdcId 167629), a real but unrelated fruit that happens to share the word
  "banana". Not wrong data, just a confusable neighbor in embedding space.
- **Item 2c — "olive oil" noise:** Ranks 2-3 are `Oil, avocado` and
  `Oil, almond` rather than another olive-oil preparation. All three are
  genuine oils with correct nutrient data, just not olive oil specifically —
  rank 1 is correct (`Oil, olive, salad or cooking`).
- **Item 2d — near-duplicate clusters:** `kale` and `whole milk` each return
  the same underlying food from both `foundation_food` and `sr_legacy_food`
  as two of the three candidates (e.g. "Kale, raw" appears once from each
  source with near-identical similarity). This is 01-RESEARCH.md's
  documented, accepted Pitfall 6 — MMR/diversity re-ranking to avoid showing
  the same food twice is explicitly a Phase 3/4 concern, not built here.
- **Suggested fix (not applied — out of scope for Plan 01-08):** Phase 3/4
  should consider (a) MMR-style diversity re-ranking so near-duplicate
  candidates don't crowd out a third genuinely different option, and/or
  (b) prepending the FDC food category to the embedding text (01-RESEARCH.md
  Open Question #2) if a future audit shows category confusion recurring
  beyond these four names.
- **Impact:** Low for now — all 10 hand-picked names still return at least
  one correct candidate in their top 3, and the mandatory manual-confirmation
  step (TECH_SPEC §5.6) is the actual safety net for exactly this class of
  imperfection. Revisit if Phase 3/4 real-usage data shows users frequently
  having to pick rank 2/3, or if a wider ingredient-name audit surfaces more
  than these four confusable cases.
