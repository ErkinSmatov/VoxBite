---
phase: 01-foundation-data-domain-math
plan: 08
subsystem: database
tags: [pgvector, hnsw, openai-embeddings, matching, drizzle, usda-fdc]

# Dependency graph
requires:
  - phase: 01-foundation-data-domain-math
    provides: "01-03's fdc_foods table + HNSW index, 01-06's OpenAI embedding adapter, 01-07's live 8,220-row index"
provides:
  - "matchIngredient(): pure domain function (src/domain/fdc-matching/) that turns an embedding into exactly 3 ranked, source-filtered FDC candidates through an injectable FdcRepository port"
  - "createDrizzleFdcRepository(): the real Postgres/pgvector implementation, confirmed via EXPLAIN to use the fdc_foods_embedding_hnsw index, not a sequential scan"
  - "npm run verify-matches: scripted, owner-confirmed plausibility check over 10 hand-picked ingredient names"
  - "D-02 amendment: the live embedding model is text-embedding-3-large truncated to 1536 dims (OpenAI dimensions parameter), not text-embedding-3-small — all 8,220 rows re-indexed under the new model"
affects: ["Phase 3 (voice pipeline calls matchIngredient for every decomposed dish component)", "Phase 4 (3-candidate correction picker consumes FdcCandidate shape and the raw/cooked + near-duplicate observations below)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pgvector ORDER BY must use the raw distance expression (e.g. cosineDistance(...) ascending), never a computed similarity alias (1 - distance) with desc() — the alias form defeats the query planner's ability to recognize the index-friendly ORDER BY pattern and silently falls back to a full Seq Scan. Always confirm with EXPLAIN (ANALYZE, BUFFERS), never assume an index is used just because it exists."
    - "Embedding model regressions can be dimension-specific and query-specific: a 10-name smoke test did not catch the text-embedding-3-small wild-rice failure across the full 141-row rice population — a targeted A/B over the live affected rows, not just the fixed test set, was needed to confirm the fix and catch a second failure (brown rice) the smoke test had missed."

key-files:
  created:
    - src/domain/fdc-matching/types.ts
    - src/domain/fdc-matching/match-ingredient.ts
    - src/domain/fdc-matching/match-ingredient.test.ts
    - src/domain/fdc-matching/index.ts
    - src/adapters/fdc-repository.ts
    - scripts/index-fdc/verify-matches.ts
  modified:
    - src/adapters/embeddings/types.ts
    - src/adapters/embeddings/openai-embed.ts
    - src/adapters/embeddings/openai-embed.test.ts
    - src/db/schema/fdc-foods.ts
    - scripts/index-fdc/verify-index.ts
    - scripts/check-setup.ts
    - scripts/verify-schema.ts

key-decisions:
  - "D-02 amended: embedding model changed from text-embedding-3-small to text-embedding-3-large, truncated to 1536 dimensions via OpenAI's native `dimensions` request parameter (not a client-side vector slice) — keeps the existing vector(1536) column and fdc_foods_embedding_hnsw index unchanged (pgvector's HNSW has a 2000-dim ceiling, so large's native 3072 dims could not be used directly). Triggered by a real retrieval failure (wild rice ranking above white rice), not a hypothetical concern; this is the exact escalation path STACK.md pre-authorized for confusable top-3 candidates."
  - "All 8,220 fdc_foods rows re-embedded and re-indexed under the new model for $0.0144 total OpenAI cost, owner-approved before running."
  - "findNearest orders by the raw cosineDistance(...) expression ascending, never by a computed similarity alias descending — see Critical Finding below."
  - "Accepted, not fixed in this phase: 'chicken egg' rank-1 regression, 'banana'/'olive oil' confusable neighbors, and kale/whole-milk near-duplicate source pairs — logged to deferred-items.md item 2 for Phase 3/4 to revisit (MMR-style diversity re-ranking or category-prefixed embedding text)."

requirements-completed: [MATCH-01, MATCH-02]

# Metrics
duration: ~50min
completed: 2026-08-11
---

# Phase 1 Plan 08: FDC Ingredient Matching Summary

**Built the pure `matchIngredient()` domain function and its Drizzle/pgvector repository, then — while proving the result plausible to the owner — found and fixed a real embedding-model retrieval bug (wild rice outranking white rice) and a real query-planner bug (the HNSW index was silently being bypassed for a full table scan), re-indexing all 8,220 FDC rows under a corrected model for under two cents.**

## Performance

- **Duration:** ~50 min
- **Completed:** 2026-08-11
- **Tasks:** 3 (2 auto tasks + 1 checkpoint, resolved after a model-and-bug-fix detour)
- **Files modified:** 6 created, 7 modified

## Accomplishments

- `src/domain/fdc-matching/` — a pure, hexagonal domain module: `matchIngredient()` takes an embedding + injectable `FdcRepository` port and returns exactly 3 ranked, `ALLOWED_SOURCES`-filtered candidates, with zero imports of drizzle/postgres/openai (enforced by a static grep check in the plan's verify step). Over-fetches `topN * 2` candidates so source-filtering never shortens the result below 3 when avoidable.
- `src/adapters/fdc-repository.ts` — `createDrizzleFdcRepository(db)` runs the cosine search server-side against the live Postgres table, no JavaScript distance loop.
- `scripts/index-fdc/verify-matches.ts` (`npm run verify-matches`) — embeds 10 hand-picked ingredient names in one batched call, prints ranked candidate blocks, and mechanically asserts: exactly 3 candidates per name, every source in `ALLOWED_SOURCES`, similarity in [0,1], no brand-name probe hit. Exits 0 and prints `MATCHES OK`.
- **Owner checkpoint resolved with a real bug found and fixed, not just approved as-is** — see Critical Finding and Embedding Model Change below.
- Final `npm test` 117/117, `npx tsc --noEmit` clean, `npm run verify-schema` / `verify-index` / `verify-matches` all exit 0.

## Critical Finding: the HNSW index was silently NOT being used

**Plain-language explanation (for a reader with no database background):** Think of the `fdc_foods` table as a phone book with 8,220 entries, and the HNSW index as a shortcut — like a phone book's alphabetical tabs — that lets Postgres jump almost straight to the closest matches instead of reading every single entry to check its distance. A "**Seq Scan**" (sequential scan) means Postgres ignored the shortcut and read all 8,220 rows one by one, computing the distance for every single one, every single time a user's ingredient gets matched. An "**Index Scan**" means it used the shortcut and only touched a tiny fraction of the rows. At 8,220 rows the difference is invisible today (both are fast), but the whole reason we built the HNSW index in Plan 03 was so this stays fast as the table grows — and the query was quietly not using it at all.

**What caused it:** `findNearest`'s original `ORDER BY` sorted by a *computed* value — `similarity = 1 - cosineDistance(...)`, sorted descending. Postgres's query planner cannot recognize that sorting a computed `1 - x` value descending is the same operation as sorting the raw `x` ascending, so it fell back to reading (and sorting) every row instead of walking the index. This was found while producing `EXPLAIN` evidence for a threat-model claim (T-01-30, "search runs against the HNSW index") that had been asserted but never actually verified against a live query plan.

**Fix (commit `35ac9f3`):** order by the raw `cosineDistance(fdcFoods.embedding, embedding)` expression ascending instead — `similarity` is still computed and returned to the caller for display, it is just never the sort key. Confirmed via `EXPLAIN (ANALYZE, BUFFERS)`:

| | Before | After |
|---|---|---|
| Plan | Seq Scan (all 8,220 rows) | `Index Scan using fdc_foods_embedding_hnsw` |
| Execution Time | not benchmarked (bug found before benchmarking) | 0.707 ms |
| Buffers | full-table read | shared hit=425 |

**Lesson carried forward:** a threat-model "mitigate" disposition (T-01-30) is not proven by writing index-friendly-looking SQL — it must be checked against a live `EXPLAIN` plan, because pgvector/Postgres query planning around computed sort expressions is non-obvious.

## Embedding Model Change (D-02 amendment)

**What happened, in order:**

1. First `npm run verify-matches` run (on `text-embedding-3-small`) showed "white rice" returning three **Wild rice** records and zero actual white-rice records — a real, non-plausible result. The correct `Rice, white, ...` rows existed in the table but ranked 4th-10th, only ~0.01 cosine-similarity behind the wild-rice rows, because short descriptions ("Wild rice, cooked") were scoring higher than longer, more specific ones ("Rice, white, short-grain, enriched, uncooked").
2. Owner + orchestrator ran an A/B test over all 141 live rice-related rows (not just the 10-name smoke set). This surfaced a **second** failure the smoke test alone had missed: "brown rice" also returned Wild rice at ranks 1-2 under `text-embedding-3-small`.
3. `text-embedding-3-large` fixed both queries. Its native output is 3072 dimensions, which exceeds pgvector's 2000-dimension ceiling for HNSW indexes, so it was truncated to **1536 dimensions using OpenAI's own `dimensions` request parameter** (Matryoshka representation learning — the model is trained so a truncated prefix of the embedding is still meaningful, unlike a naive client-side slice). This kept the existing `vector(1536)` column and `fdc_foods_embedding_hnsw` index completely unchanged — no schema migration needed.
4. Owner approved the switch. Commit `fded186` changed the model config (and de-duplicated three separate hardcoded copies of the model/dimension constants across `verify-index.ts`, `check-setup.ts`, and the schema file into one shared source in `src/adapters/embeddings/types.ts` — the drift between those copies is exactly what let a model mismatch reach `verify-matches` undetected). Commit `35ac9f3` (same session) then found and fixed the Seq Scan bug above while re-verifying.
5. All 8,220 rows re-indexed under the new model. **Actual cost: $0.0144** (re-run confirmed by the orchestrator independently — `embedding_model_version = text-embedding-3-large`, `vector_dims = 1536` on all 8,220 rows; row counts unchanged at 427 `foundation_food` + 7,793 `sr_legacy_food`).

**This amends the phase's earlier D-02 decision** ("Embedding input text is the bare description string only") — the *input text* decision stands, but the *model* is now `text-embedding-3-large@1536`, not `text-embedding-3-small@1536`. Any future re-index script or documentation referencing the model name must use the new value.

## Final `verify-matches` Owner Verdict (10 hand-picked names)

Ran live against the current index; full block-by-block output re-confirmed by this executor before writing this summary.

**Fixed by the model switch:**
- "white rice" — now returns 3 correct white-rice rows (glutinous/short-grain, uncooked/cooked variants), zero wild rice.
- "brown rice" — same fix, confirmed in the 141-row A/B, not independently re-verified in the 10-name smoke set (brown rice is not one of the 10 names, but the underlying table rows are shared).
- "cheddar cheese" — rank 2 improved from a generic colby-blend entry to sharp cheddar specifically.

**Regressed by the model switch (accepted, not reverted):**
- "chicken egg" — rank 1 is now `Bread, egg` (fdcId 172673), pushing the real `Egg, whole, raw, fresh` (fdcId 171287) to rank 2. On the old model all 3 candidates were eggs. Judged acceptable because the user always confirms/corrects the match manually before saving (TECH_SPEC §5.6) — but Phase 4's picker must make selecting rank 2/3 low-friction. Logged in deferred-items.md item 2a.

**Residual noise, unrelated to the model switch, carried to Phase 4 (deferred-items.md item 2):**
- "banana" — rank 2 is `Melon, banana (Navajo)`, a real but unrelated fruit.
- "olive oil" — ranks 2-3 are avocado oil and almond oil, not another olive-oil preparation (rank 1 is correct).
- "kale" and "whole milk" — near-duplicate clusters: the same underlying food appears from both `foundation_food` and `sr_legacy_food` as two of the three candidates. This is 01-RESEARCH.md's documented, accepted Pitfall 6 (MMR/diversity re-ranking is explicitly out of scope for this phase).

**Verdict:** all 10 names return at least one plausible, correctly-identified candidate in their top 3. No candidate in any block matched the brand-name probe (`sabra`/`kellogg`/`nestle`). At least one `нет данных` (null sugar) rendered correctly for names where USDA genuinely has no sugar value (e.g. "chicken breast" rank 1, "white rice" all 3 ranks, "rolled oats" ranks 1-2) — confirmed never coalesced to 0. Owner accepted this as satisfying phase success criterion #4 ("3 plausible FDC candidates"), with the chicken-egg regression and the residual noise explicitly carried forward rather than silently dropped.

## Task Commits

1. **Task 1: FdcRepository port + pure matchIngredient function** — `9b26efe` (feat, TDD)
2. **Task 2: Drizzle/pgvector repository + verify-matches script** — `4ba03b9` (feat)
3. **Task 3 detour: switch embedding model to text-embedding-3-large@1536** — `fded186` (fix)
4. **Task 3 detour: order pgvector query by raw distance, not a similarity alias** — `35ac9f3` (fix)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `src/domain/fdc-matching/types.ts` — `FdcRepository` port, `FdcCandidate` shape, `CANDIDATE_COUNT`, `ALLOWED_SOURCES`
- `src/domain/fdc-matching/match-ingredient.ts` — pure `matchIngredient()`, over-fetch + filter + sort + truncate, no adapter imports
- `src/domain/fdc-matching/match-ingredient.test.ts` — fake-repository TDD suite
- `src/domain/fdc-matching/index.ts` — public barrel
- `src/adapters/fdc-repository.ts` — `createDrizzleFdcRepository`, corrected `ORDER BY` (see Critical Finding)
- `scripts/index-fdc/verify-matches.ts` — `npm run verify-matches`, 10-name plausibility + assertion script
- `src/adapters/embeddings/types.ts` — `EMBEDDING_MODEL` now `text-embedding-3-large`, `EMBEDDING_DIMENSIONS` stays `1536` via the OpenAI `dimensions` param
- `src/adapters/embeddings/openai-embed.ts`, `openai-embed.test.ts` — pass `dimensions` through to the OpenAI embeddings call
- `src/db/schema/fdc-foods.ts`, `scripts/index-fdc/verify-index.ts`, `scripts/check-setup.ts` — import the shared model/dimension constants instead of re-declaring local copies

## Interface for Phase 3/4

```ts
matchIngredient(args: {
  embedding: number[];       // 1536-dim, from createOpenAIEmbedder / text-embedding-3-large@1536
  repo: FdcRepository;       // createDrizzleFdcRepository(db) in production
  topN?: number;             // defaults to 3
}): Promise<FdcCandidate[]>
```

`FdcCandidate` carries full per-100g nutrients (`kcal`, `proteinG`, `fatG`, `carbsG`, `sugarG` — all `number | null`) plus `description`, `source`, `similarity`, so Phase 4's math needs no second query and cannot read a fabricated 0 for missing sugar.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] HNSW index silently bypassed by a computed sort-key alias**
- **Found during:** Task 3 checkpoint, while producing `EXPLAIN` evidence for the threat-model's T-01-30 claim
- **Issue:** `ORDER BY desc(1 - cosineDistance(...))` defeats the Postgres planner's index-friendly ORDER BY recognition, causing a full Seq Scan on every match query
- **Fix:** Order by the raw `cosineDistance(...)` expression ascending instead; `similarity` is still computed and returned but never used as the sort key
- **Files modified:** `src/adapters/fdc-repository.ts`
- **Commit:** `35ac9f3`

**2. [Rule 4 - Architectural, owner-approved] Embedding model changed from text-embedding-3-small to text-embedding-3-large@1536**
- **Found during:** Task 3 checkpoint — verify-matches exposed a real, non-plausible "white rice" → Wild rice failure
- **Why this is Rule 4, not Rule 1:** changing the embedding model requires re-indexing all 8,220 rows (a paid, all-rows operation) and amends a previously recorded decision (D-02) — this was surfaced to the owner rather than silently auto-fixed, and the owner approved before the re-index ran
- **Fix:** Switched to `text-embedding-3-large` truncated to 1536 dims via OpenAI's native `dimensions` parameter; no schema/index migration needed. Re-indexed all 8,220 rows for $0.0144.
- **Files modified:** `src/adapters/embeddings/types.ts`, `src/adapters/embeddings/openai-embed.ts`, `src/adapters/embeddings/openai-embed.test.ts`, `src/db/schema/fdc-foods.ts`, `scripts/index-fdc/verify-index.ts`, `scripts/check-setup.ts`, `scripts/verify-schema.ts`
- **Commit:** `fded186`

## Known Stubs

None — this plan wires real data through the full path (embedding → pgvector query → typed candidates), no placeholder/mock data.

## Threat Flags

None — both threat-model items exercised in this plan (T-01-27 source allow-listing, T-01-30 HNSW index usage) were verified for real: T-01-27 by unit test + `verify-matches`'s own source assertion, T-01-30 by live `EXPLAIN` evidence after the bug fix above. No new surface introduced beyond what the plan's threat model already covers.

## Self-Check: PASSED

- `src/domain/fdc-matching/types.ts` — FOUND
- `src/domain/fdc-matching/match-ingredient.ts` — FOUND
- `src/domain/fdc-matching/match-ingredient.test.ts` — FOUND
- `src/domain/fdc-matching/index.ts` — FOUND
- `src/adapters/fdc-repository.ts` — FOUND
- `scripts/index-fdc/verify-matches.ts` — FOUND
- Commit `9b26efe` — FOUND in `git log`
- Commit `4ba03b9` — FOUND in `git log`
- Commit `fded186` — FOUND in `git log`
- Commit `35ac9f3` — FOUND in `git log`
- `npm test` 117/117 — CONFIRMED (re-ran live)
- `npx tsc --noEmit` clean — CONFIRMED (re-ran live)
- `npm run verify-matches` exits 0, prints `MATCHES OK` — CONFIRMED (re-ran live)
