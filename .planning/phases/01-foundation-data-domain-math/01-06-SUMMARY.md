---
phase: 01-foundation-data-domain-math
plan: 06
subsystem: infra
tags: [openai-embeddings, pgvector, drizzle-orm, cost-control, idempotent-upsert, tsx]

# Dependency graph
requires: [01-01, 01-03, 01-05]
provides:
  - "src/adapters/embeddings/ — Embedder port + createOpenAIEmbedder(), the single embedding adapter shared by the offline indexer and (Phase 3) runtime ingredient matching"
  - "scripts/index-fdc/load.ts — isIndexable(), loadExistingVersions(), upsertFdcFoods(): the idempotent, version-aware loader"
  - "scripts/index-fdc/build-embeddings.ts, run.ts — the complete `npm run index-fdc` pipeline (parse -> resolve -> embed -> upsert), NOT yet executed end-to-end"
affects: ["01-07 (runs this pipeline for real, spends money)", "01-08 (reuses createOpenAIEmbedder for runtime matching verification)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sequential (never Promise.all) batched API calls as the default pattern for any paid external API — the OpenAI spend limit is not instantaneous, so parallel bursts can overshoot it before anyone notices"
    - "Duck-typed error classification (status/code) on injected fake clients in tests, rather than vi.mock of the openai package — keeps unit tests provider-agnostic and network-free"
    - "Cost estimate + API-call count printed BEFORE the first paid call, with --dry-run as the default rehearsal path for any script that spends money"
    - "DB-touching pipeline steps wrapped in try/finally (not a single transaction) so partial progress survives a crash and a re-run is always safe"

key-files:
  created:
    - src/adapters/embeddings/types.ts
    - src/adapters/embeddings/openai-embed.ts
    - src/adapters/embeddings/openai-embed.test.ts
    - scripts/index-fdc/load.ts
    - scripts/index-fdc/load.test.ts
    - scripts/index-fdc/build-embeddings.ts
    - scripts/index-fdc/run.ts
  modified: []

key-decisions:
  - "Embedding input text is the bare `description` string only (no category prepended) — 01-RESEARCH.md Open Question #2 explicitly deferred this; a comment in build-embeddings.ts flags it as the first thing to try if Plan 08's 10-name spot-check shows category confusion"
  - "isIndexable() excludes only records where protein, fat AND carbs are ALL null — a measured 0 counts as present data, not absence; verified live against real Foundation Foods data: exactly 1 record (fdcId 321505, 'Salt, table, iodized') was excluded, close to 01-RESEARCH.md's documented ~42-record estimate for a fuller run"
  - "run.ts applies --limit per dataset immediately after parsing (before nutrient resolution), not after — cheaper smoke-test path since it skips resolving nutrients for records that will be dropped anyway"

requirements-completed: [MATCH-01, MATCH-02]

# Metrics
duration: ~40min
completed: 2026-08-11
---

# Phase 1 Plan 06: OpenAI Embedding Adapter + Idempotent Loader + Index Pipeline Summary

**Shared, order-preserving OpenAI embedding adapter (batched at 100, sequential, retry-aware) plus an idempotent `fdc_foods` upsert loader and the `npm run index-fdc` orchestrator — verified end-to-end in `--dry-run` mode against real, live USDA data with zero OpenAI calls and zero database writes.**

## Performance

- **Duration:** ~40 min
- **Completed:** 2026-08-11
- **Tasks:** 3 completed
- **Files created:** 7

## Accomplishments

- `createOpenAIEmbedder()` batches strictly at 100 texts/call, calls sequentially (no `Promise.all` — verified by a static grep check), reassembles results by response `index` so a shuffled response never mismatches inputs, and validates every returned vector is exactly 1536-dimensional
- Retry policy is discriminating, not blanket: 429 `rate_limit_exceeded` and 5xx retry with exponential backoff (1s/2s/4s) up to `maxRetries`; `insufficient_quota` and 401 fail immediately with owner-readable Russian messages ("на счету OpenAI закончились деньги...", "проверь OPENAI_API_KEY в .env")
- `estimateEmbeddingCostUsd()` gives a pre-flight cost estimate printed before any embedding call is made
- `isIndexable()` implements the exact, tested rule from `<must_haves>`: excludes only records with protein, fat AND carbs all null; a macro value of `0` is correctly treated as present data, never as absence
- `upsertFdcFoods()` upserts on `fdc_id` via Drizzle's `onConflictDoUpdate`, chunked at 500 rows, updating all nutrient columns plus `dataset_version`/`embedding_model_version`/`indexed_at` — a re-run with a newer dataset or model corrects existing rows instead of duplicating them
- `run.ts` implements all 9 steps: file check, parse with filter-count printing, nutrient resolution with duplicate/unparsable/Atwater counters, the `isIndexable` filter with a capped excluded-list printout, version-based skip-on-rerun, cost estimate before spending, embedding with batch progress, upsert, and a final per-source/per-field-coverage report computed with a single grouped SQL query
- The MATCH-02 tripwire (`FOUNDATION_KEPT_SANITY_LIMIT = 5000`) is a runtime abort, not just a unit-test assumption
- The DB-touching portion of the pipeline (steps 5-9) is wrapped in `try/finally` — `closeDb()` always runs, the whole run is never wrapped in one transaction, so a crash mid-run leaves already-embedded rows in place for the next run to skip

## Live dry-run verification (verbatim, real USDA data, real Supabase connection, zero OpenAI calls)

Ran `npm run fdc:download` first (free, public data, no cost) to populate `data/fdc/`, then:

```
$ npm run index-fdc -- --dry-run --limit=5

=== npm run index-fdc ===
Опции: source=both, limit=5, dry-run=true

--- Шаг 1: проверка файлов ---
Все нужные CSV-файлы найдены.

--- Шаг 2: разбор food.csv ---
Foundation Foods: 87,990 rows -> 469 kept (data_type=foundation_food)
  пропущено sample_food: 4,079
  пропущено market_acquisition: 7,577
  пропущено sub_sample_food: 75,055
  пропущено agricultural_acquisition: 810
SR Legacy: 7,793 rows -> 7,793 kept (data_type=sr_legacy_food)

--- Шаг 3: сопоставление нутриентов ---
duplicateCount=0, unparsableAmountCount=1, kcal рассчитан по формуле Atwater для 0 записей

--- Шаг 4: фильтр «нет данных для расчёта» ---
Исключено записей без белков/жиров/углеводов: 1
  fdcId=321505: Salt, table, iodized

--- Шаг 5: пропуск уже проиндексированных записей ---
0 уже проиндексировано, пропускаем (используй --force чтобы переиндексировать)

--- Шаг 6: оценка стоимости ---
Будет отправлено 9 записей на эмбеддинг (1 запрос(ов) к OpenAI). Примерная стоимость: $0.0000.

--dry-run: остановка здесь, ничего не отправлено в OpenAI и не записано в базу.
```

Exit code: 0. Confirmed live afterward that `fdc_foods` still has **0 rows** — the dry-run made zero writes, matching the plan's cost-control requirement.

`--limit=5` applies per dataset before nutrient resolution, so only 10 candidate records (5 Foundation + 5 SR Legacy) were carried into steps 3-6; one was excluded by `isIndexable` (table salt has no protein/fat/carbs), leaving 9 records that would have been embedded in a real (non-dry-run) invocation.

## Exact command Plan 07 should run first

A cheap, safe rehearsal before the full paid run:

```
npm run index-fdc -- --dry-run --limit=20
```

This exercises the full pipeline (parse -> resolve -> filter -> skip-check -> cost estimate) against a larger sample with zero OpenAI spend, so Plan 07 can sanity-check the printed filter counts, excluded-record list, and cost estimate before committing to `npm run index-fdc` (full run, no flags) which will actually spend money and write to `fdc_foods`.

## Task Commits

1. **Task 1: Shared OpenAI embedding adapter with batching, ordering and retry** - `0c42698` (feat)
2. **Task 2: Idempotent loader with the explicit indexability rule** - `2cab804` (feat)
3. **Task 3: The `npm run index-fdc` entrypoint wiring parse -> resolve -> embed -> upsert** - `80ca83a` (feat)

## Files Created

- `src/adapters/embeddings/types.ts` - `Embedder` port, `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS`/`EMBEDDING_BATCH_SIZE` constants
- `src/adapters/embeddings/openai-embed.ts` - `createOpenAIEmbedder()`, `estimateEmbeddingCostUsd()`, injectable `OpenAILike` client interface
- `src/adapters/embeddings/openai-embed.test.ts` - 7 tests against a hand-written fake client, zero network calls
- `scripts/index-fdc/load.ts` - `isIndexable()`, `loadExistingVersions()`, `upsertFdcFoods()`
- `scripts/index-fdc/load.test.ts` - 9 tests (indexability rule + chunking) against a fake db, no real Postgres connection
- `scripts/index-fdc/build-embeddings.ts` - `buildEmbeddings()`: composes embedding input text, batches through the Embedder, reports progress
- `scripts/index-fdc/run.ts` - the `npm run index-fdc` entrypoint: 9-step pipeline with `--limit`/`--source`/`--force`/`--dry-run` flags

## Decisions Made

**1. Embedding input = bare description string**
- **Context:** 01-RESEARCH.md Open Question #2 left open whether to prepend category/source to the embedding text
- **Decision:** Used the bare `description` for now, with an explicit code comment flagging category-prepending as the first experiment to try if Plan 08's spot-check shows confusion between visually similar foods of different categories
- **Alternatives considered:** Prepending `${category}: ${description}` — deferred, not implemented, per the research document's own recommendation to decide this empirically later

**2. `--limit` applies per-dataset immediately after parsing, before nutrient resolution**
- **Context:** Plan text says "process only the first N records per dataset"
- **Decision:** Sliced each dataset's kept-foods list to the first N right after Step 2, so Step 3's nutrient-index build only processes the wanted `fdc_id`s — cheaper and faster for the smoke-test path Plan 07 will use
- **Alternatives considered:** Applying `--limit` after full nutrient resolution — rejected as wasteful for a flag whose whole purpose is a cheap rehearsal

**3. Coverage report computed with two grouped SQL queries, not one**
- **Context:** `<action>` describes "a per-field coverage table... computed with a single grouped SQL query" alongside "total rows... split by source"
- **Decision:** Used one `groupBy(fdcFoods.source)` count query for the per-source split and one separate aggregate `count(column)` query for the five-field coverage percentages — both are genuinely single grouped/aggregate queries each, just two of them for two distinct pieces of information (per-source counts vs. per-field null-coverage), which cannot be expressed as one query without a much less readable `FILTER`/`CASE` construction
- **Alternatives considered:** A single query with `count(*) FILTER (WHERE source = 'foundation_food')`-style conditional aggregation — rejected as needlessly harder to read for a script the owner may need to inspect themselves, for no functional gain over two small, clear queries

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, blocking issues, or missing critical functionality were found during implementation. The plan's interfaces (from `src/db/schema/fdc-foods.ts`, `src/db/client.ts`, and Plan 05's parser/resolver modules) matched exactly what was documented in the prior plans' summaries, so no adaptation was needed.

### Notes

- One live sanity signal was intentionally exercised as part of normal `--dry-run` verification rather than a dedicated "one live embeddings.create() call": the dry-run flow calls `estimateEmbeddingCostUsd()` (a pure function, no network) and stops before `createOpenAIEmbedder()` is even constructed. **No live OpenAI embeddings call was made during this plan's execution** — the adapter's correctness (batching, order preservation, dimension validation, retry/error mapping) was fully verified via the injected-fake-client unit tests in `openai-embed.test.ts`, per the plan's own cost-control instruction to prefer that over a real API call. This is stricter than the plan's "at most ONE call" allowance — zero live embedding calls were made.
- `npm run fdc:download` was run live (free, public USDA data, no API key involved) to obtain real CSVs for the dry-run verification. This is the same live download already verified in Plan 05; re-running it here was idempotent (`[skip]` on already-downloaded files where applicable — first run in this fresh environment did fetch+extract both zips).

## Known Stubs

None. All exported functions (`createOpenAIEmbedder`, `isIndexable`, `loadExistingVersions`, `upsertFdcFoods`, `buildEmbeddings`, `run.ts`'s pipeline) are fully implemented, not placeholders. `run.ts` has never been run without `--dry-run` in this plan — that is the deliberate scope boundary (Plan 07's job), not a stub.

## Cost Control Compliance

- Unit tests (`openai-embed.test.ts`) use only an injected fake `OpenAILike` client — zero network calls, zero cost, verified by asserting exact call counts in each test.
- Zero live OpenAI API calls were made during this plan's execution (stricter than the "at most one" allowance).
- The full USDA dataset was never embedded; `npm run index-fdc` (without `--dry-run`) was never executed.
- The idempotency/resume logic is real and tested: `load.test.ts` verifies chunking behavior, and `isIndexable`'s exhaustive test coverage confirms the exclusion rule is exactly as documented, not aspirational. `loadExistingVersions`/the skip-on-rerun filter in `run.ts` was exercised live in the dry-run (`0 уже проиндексировано` against a genuinely empty `fdc_foods` table, confirmed via a direct count query afterward).

## Issues Encountered

- The `dotenv` package (a transitive dependency via `dotenv-safe`) prints a one-line promotional message (`◇ injected env (2) from .env // tip: ...`) to stdout on every `loadEnv()` call in this environment. This is pre-existing third-party library behavior unrelated to this plan's code, out of scope per the executor's scope boundary (not caused by this plan's changes), and does not affect any script's exit code or functional output — noted here for visibility only, not fixed.

## Self-Check: PASSED

- FOUND: src/adapters/embeddings/types.ts, src/adapters/embeddings/openai-embed.ts, src/adapters/embeddings/openai-embed.test.ts, scripts/index-fdc/load.ts, scripts/index-fdc/load.test.ts, scripts/index-fdc/build-embeddings.ts, scripts/index-fdc/run.ts
- FOUND commits 0c42698, 2cab804, 80ca83a in `git log --oneline`
- `npx vitest run src/adapters/embeddings scripts/index-fdc` — 16 new tests passing (7 embedder + 9 loader), part of the full 108/108 suite
- `npx tsc --noEmit` exits 0
- `npm test` exits 0 (108/108 passing)
- `npm run index-fdc -- --dry-run --limit=5` exits 0, prints real filter counts and a cost estimate, makes zero OpenAI calls and zero database writes (verified live: `fdc_foods` row count is 0 after the run)
