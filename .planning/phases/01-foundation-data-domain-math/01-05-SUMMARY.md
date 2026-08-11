---
phase: 01-foundation-data-domain-math
plan: 05
subsystem: infra
tags: [usda-fdc, csv-parse, streaming, data-pipeline, tsx, vitest]

requires:
  - phase: 01-foundation-data-domain-math
    provides: "package.json fdc:download script, tsconfig, vitest config, .gitignore (data/) — built by the parallel plan 01-04 agent, not present in this worktree during execution"
provides:
  - "Idempotent download+unzip of Foundation Foods and SR Legacy USDA FDC bundles into git-ignored data/fdc/"
  - "Streaming food.csv parsers with the mandatory foundation_food data_type filter (verified against real USDA data: 87,990 rows -> 469 kept)"
  - "Priority-ordered nutrient resolution (kcal 1008/2047/2048, sugar 2000/1063) with strict null-never-0 semantics"
affects: ["01-06 (embeds and loads these records into pgvector)"]

tech-stack:
  added: [csv-parse]
  patterns:
    - "Streaming CSV parse via fs.createReadStream().pipe(parse({columns:true})) + for-await, never buffering multi-MB files into memory"
    - "Explicit blank-string guard before Number() conversion — Number('') is 0 in JS, not NaN, so empty-amount detection must trim-and-check before parsing, or missing data silently becomes a measured zero"
    - "Pure file-in/object-out modules with zero DB/OpenAI imports, so the data-mapping logic is unit-testable for free before any embedding money is spent"

key-files:
  created:
    - scripts/index-fdc/datasets.ts
    - scripts/index-fdc/download.ts
    - scripts/index-fdc/parse-foundation.ts
    - scripts/index-fdc/parse-foundation.test.ts
    - scripts/index-fdc/parse-sr-legacy.ts
    - scripts/index-fdc/resolve-nutrients.ts
    - scripts/index-fdc/resolve-nutrients.test.ts
    - scripts/index-fdc/__fixtures__/food-foundation-sample.csv
    - scripts/index-fdc/__fixtures__/food-sr-legacy-sample.csv
    - scripts/index-fdc/__fixtures__/food-nutrient-sample.csv
  modified: []

key-decisions:
  - "Verified the two USDA zip URLs live (HTTP 200, actual byte sizes ~3.8MB/~6MB — much smaller than the 30-40MB estimate in the plan) and ran the real download+extract+idempotent-skip cycle end to end, not just a fixture-based unit test."
  - "Housed the shared CSV-streaming helper (streamFoodCsv) inside parse-foundation.ts rather than a separate parse-common.ts file, because the plan's own automated verify script grep-checks parse-foundation.ts's literal source for 'csv-parse' and 'createReadStream' — a separate helper file would have passed the tests but failed that specific acceptance check."
  - "Set up a temporary, untracked local dev harness (package.json/tsconfig.json/vitest.config.ts/node_modules) to run tsc/vitest for verification, then deleted it before finishing — Plan 01's canonical package.json/tsconfig/vitest.config were not present in this worktree because the parallel agent building them (plan 01-04) runs in a separate worktree and had not merged yet. None of these temp files were ever staged or committed."

patterns-established:
  - "Pattern: data-acquisition/data-mapping scripts for one-time indexing jobs live under scripts/<job-name>/ as pure functions with fixtures under __fixtures__/, fully testable without DB/network."

requirements-completed: [MATCH-02]

duration: ~35min
completed: 2026-08-11
---

# Phase 1 Plan 05: FDC Download + Parse + Nutrient Resolution Summary

**Idempotent USDA FDC bundle downloader plus streaming food.csv/food_nutrient.csv parsers that enforce the foundation_food data_type filter and a priority-ordered, null-never-0 nutrient resolution table — verified end-to-end against live USDA data, not just fixtures.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files modified:** 10 (all new)

## Accomplishments

- `npm run fdc:download`-equivalent pipeline (`scripts/index-fdc/download.ts`) fetches and unpacks both FDC bundles, streams the response body (no whole-body buffering), skips already-downloaded/extracted work unless `--force`, and fails with actionable remediation naming the exact URL to re-check on USDA's download-datasets page.
- Ran this against the **real, live USDA endpoints** (not simulated): both zip URLs returned HTTP 200, download+extract completed, and a second run correctly printed `[skip]` for both the zip and the extracted directory.
- `parseFoundationFoods` filters `food.csv` to `data_type === 'foundation_food'` only — verified against the real Foundation Foods bundle: **87,990 total rows → 469 kept**, with the remaining rows correctly bucketed into `skippedByDataType` (`sample_food: 4079, market_acquisition: 7577, sub_sample_food: 75055, agricultural_acquisition: 810`). This exactly matches 01-RESEARCH.md's cited 0.53% figure.
- `parseSrLegacyFoods` asserts every SR Legacy row is `sr_legacy_food` and throws (naming the offending `fdc_id` and value) if not.
- `resolveNutrient`/`resolveFoodNutrients` implement the priority-ordered ID table (kcal: 1008→2047→2048, sugar: 2000→1063) with strict null (never 0) semantics, an Atwater kcal fallback that only fires when all three macros are non-null, and `kcalDerived` flagging for the loader to log.
- `buildNutrientIndex` streams `food_nutrient.csv`, filters to `wantedFdcIds` before parsing numbers (hot-path optimization for 200k+ rows), and reports `duplicateCount`/`unparsableAmountCount` instead of silently absorbing them.
- Ran the nutrient resolver against the **real** Foundation Foods `food_nutrient.csv` for all 469 kept records: 91 correctly resolved to `kcal: null` (no fabricated Atwater fallback where macros were also missing), 185 had real sugar data, 33 unparsable amounts and 1 duplicate `(fdc_id, nutrient_id)` pair were correctly detected and counted rather than defaulted to 0 or silently overwritten.

## Task Commits

1. **Task 1: Dataset manifest and idempotent download/unzip** - `8bc96e2` (feat)
2. **Task 2: Streaming food.csv parsers (TDD)** - `8422583` (test, RED) → `37f434c` (feat, GREEN)
3. **Task 3: Priority-ordered nutrient resolution (TDD)** - `d3ef154` (test, RED) → `2a8aa96` (feat, GREEN)

## Files Created/Modified

- `scripts/index-fdc/datasets.ts` - `FDC_DATASETS` manifest (URLs, versions, extract dirs) + `findFileRecursive`/`resolveExtractedCsvPaths` helpers for locating CSVs inside the nested, version-named extraction folders
- `scripts/index-fdc/download.ts` - `downloadDatasets()` + CLI entrypoint; streams via `node:stream/promises` `pipeline`, `--force`/`--only` flags, idempotent skip logic
- `scripts/index-fdc/parse-foundation.ts` - `parseFoundationFoods()`, `FOUNDATION_DATA_TYPE` constant, and the shared `streamFoodCsv` helper (also used by parse-sr-legacy.ts)
- `scripts/index-fdc/parse-sr-legacy.ts` - `parseSrLegacyFoods()`, asserts the no-filter-needed invariant
- `scripts/index-fdc/parse-foundation.test.ts` - 11 tests covering both parsers
- `scripts/index-fdc/resolve-nutrients.ts` - `NUTRIENT_ID_PRIORITY`, `resolveNutrient`, `resolveFoodNutrients`, `buildNutrientIndex`
- `scripts/index-fdc/resolve-nutrients.test.ts` - 19 tests covering fallback order, null/0 distinction, Atwater fallback, duplicates
- `scripts/index-fdc/__fixtures__/food-foundation-sample.csv` - includes the real `HUMMUS, SABRA CLASSIC` market_acquisition row
- `scripts/index-fdc/__fixtures__/food-sr-legacy-sample.csv`
- `scripts/index-fdc/__fixtures__/food-nutrient-sample.csv` - exercises every fallback/edge case in `<behavior>`

## Decisions Made

- Shared CSV-streaming mechanics (`streamFoodCsv`) live inside `parse-foundation.ts` (imported by `parse-sr-legacy.ts`) rather than a standalone `parse-common.ts`, so the plan's automated verify script (which greps `parse-foundation.ts`'s literal source for `csv-parse`/`createReadStream`) passes without weakening the actual factoring the plan asked for.
- Verified real zip filenames/URLs are current as of 2026-08-11 (matches the header comment's "verified 2026-08-10" note within a day): both `FoodData_Central_foundation_food_csv_2026-04-30.zip` and `FoodData_Central_sr_legacy_food_csv_2018-04.zip` resolve with HTTP 200 at `https://fdc.nal.usda.gov/fdc-datasets/<zipName>`.
- Real row counts observed (for Plan 06's `run.ts` to cross-check against): Foundation `food.csv` = 87,990 data rows → 469 `foundation_food`; SR Legacy `food.csv` = 7,793 rows, all `sr_legacy_food`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `Number('')` is `0` in JavaScript, not `NaN` — empty amounts were silently resolving to a measured zero**
- **Found during:** Task 3, TDD GREEN phase (`buildNutrientIndex` empty-amount test failed: expected `null`, got `0`)
- **Issue:** The initial implementation parsed `amount` with `Number(record.amount)` guarded by `Number.isFinite`. Since `Number('')` and `Number('   ')` both evaluate to `0` (a finite number), an empty CSV cell was passing the finite check and being stored as a real measured `0` — exactly the null-vs-zero conflation TECH_SPEC §5.8 and this plan's whole purpose forbid.
- **Fix:** Added an explicit `record.amount?.trim()` blank-string check before the `Number()` conversion; blank input now short-circuits straight to `NaN` (counted in `unparsableAmountCount`) instead of reaching `Number()` at all.
- **Files modified:** `scripts/index-fdc/resolve-nutrients.ts`
- **Verification:** `npx vitest run scripts/index-fdc/resolve-nutrients.test.ts` — 19/19 passing after the fix; also confirmed against the real Foundation Foods `food_nutrient.csv` (33 unparsable amounts correctly counted, non-zero as 01-RESEARCH.md predicted).
- **Committed in:** `2a8aa96` (Task 3 GREEN commit)

**2. [Rule 3 - Blocking] Plan 01's package.json/tsconfig/vitest infrastructure was not present in this worktree**
- **Found during:** Start of execution (before Task 1)
- **Issue:** This plan's `depends_on: [01]` and its `<read_first>` sections assume `package.json` (with the `fdc:download` script), `tsconfig.json`, `vitest.config.ts`, and `.gitignore` (with `data/` ignored) already exist from Plan 01. This worktree branched from a commit where Plan 01 had not yet been executed — it was being built concurrently by a separate agent in a separate worktree (per this plan's `<parallel_execution>` instructions), so none of that infrastructure was available here.
- **Fix:** Created a temporary, untracked local dev harness (`package.json`, `tsconfig.json`, `vitest.config.ts`, `node_modules`) with the same TypeScript/vitest/csv-parse versions the project's STACK.md specifies, to run `npx tsc --noEmit` and `npx vitest run` for real verification of every task. None of these files were ever `git add`ed or committed — they were deleted before finishing, and `git status --short` confirms the worktree is clean except for this plan's own files.
- **Files modified:** None of this plan's tracked files were affected; only temporary, deleted, never-staged local tooling.
- **Verification:** `git status --short` after cleanup shows no untracked files; `git log` shows only the three task commits plus this SUMMARY commit.
- **Committed in:** N/A (never staged)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 blocking infra workaround)
**Impact on plan:** The `Number('')` fix is a correctness-critical fix directly serving this plan's core purpose (null-never-0 nutrient semantics) — without it, the plan's own stated goal would have been silently violated. The temporary dev harness had zero effect on the committed deliverable; it existed only to make `npx tsc --noEmit`/`npx vitest run` runnable for verification during parallel execution before Plan 01 merges.

## Issues Encountered

- `Readable.fromWeb()` needed an explicit `import { Readable } from 'node:stream'` rather than a lazy `require()` inside the ESM module — resolved immediately, no impact on committed code.
- The real USDA zip files are much smaller (~3.8MB Foundation, ~6MB SR Legacy) than the plan's "~30-40MB" estimate, which made a full live download-and-verify feasible instead of relying on a HEAD/range request as `<network_note>` recommended as a fallback for large files.

## User Setup Required

None - no external service configuration required. (USDA FDC downloads use unauthenticated public HTTPS endpoints; no API key needed for the bulk CSV bundles.)

## Next Phase Readiness

- Plan 06 can call `downloadDatasets()`, `parseFoundationFoods()`/`parseSrLegacyFoods()`, and `buildNutrientIndex()`/`resolveFoodNutrients()` directly — all four modules are DB-free and OpenAI-free, matching the plan's interface contract exactly.
- Blocker for a full end-to-end phase verification: this worktree does not yet have Plan 01's `package.json` (with the real `fdc:download` npm script), `tsconfig.json`, `vitest.config.ts`, or `.gitignore` (`data/` entry) merged in. Until the orchestrator merges the parallel plan 01-04 worktree, `npm run fdc:download` and `npm test` as literal commands will not resolve in this branch — the underlying `scripts/index-fdc/*.ts` modules were nonetheless fully verified via a temporary equivalent toolchain (see Deviation 2) and behave correctly against live USDA data.
- Real counts for Plan 06's cross-check: Foundation Foods 469 kept / 87,990 total; SR Legacy 7,793 rows all kept; 91/469 Foundation records have null kcal (real, not fabricated); 185/469 have sugar data.

---
*Phase: 01-foundation-data-domain-math*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 10 created files verified present on disk; all 5 task commits (`8bc96e2`, `8422583`, `37f434c`, `d3ef154`, `2a8aa96`) verified present in `git log`.
