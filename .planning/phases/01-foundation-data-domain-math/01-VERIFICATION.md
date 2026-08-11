---
phase: 01-foundation-data-domain-math
verified: 2026-08-11T16:30:00Z
status: passed
score: 4/4 roadmap success criteria verified (plus 8/8 plan-level must_haves spot-checked)
overrides_applied: 0
---

# Phase 1: Foundation — data + domain math Verification Report

**Phase Goal:** Postgres schema, offline USDA FDC indexing pipeline, and a pure, fully unit-testable domain layer (nutrition target math + FDC embedding matching) exist and are validated — independent of any Telegram code.
**Verified:** 2026-08-11T16:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

All evidence below was independently reproduced against the live codebase and the live Supabase database (read-only queries), not taken from SUMMARY.md claims.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Postgres schema (users, diary, `fdc_foods` with a pgvector column) exists and migrations run cleanly against a fresh database | VERIFIED | Live `npm run verify-schema` run by this verifier: all 3 tables present, migration log shows 3 applied migrations (drizzle-kit migrate, not push), `fdc_foods.embedding` is `vector(1536)` NOT NULL, HNSW index confirmed live via `EXPLAIN` (`Index Scan using fdc_foods_embedding_hnsw`, not Seq Scan), RLS enabled on all 3 tables (`drizzle/0002_enable_rls.sql` read directly) |
| 2 | Offline FDC indexing pipeline populates `fdc_foods` from Foundation Foods + SR Legacy only, with per-record embedding and per-100g nutrients incl. nullable sugar | VERIFIED | Live `npm run verify-index`: 8,220 rows (427 foundation_food + 7,793 sr_legacy_food, only these two `source` values), 100% embedding coverage at 1536 dims, sugar coverage 75.2% (NULL count 2,041 vs. exact-zero count 2,122 — proves NULL is not coalesced to 0), single `embedding_model_version` per dataset batch (`text-embedding-3-large`) |
| 3 | Unit tests pass for target-calorie/macro calc (Mifflin-St Jeor + TDEE + ≤1kg/month cap + safety floor + macro split) across sex/goal cases | VERIFIED | `npm test`: 169/169 passing across 12 files (independently re-run by this verifier, not taken from SUMMARY); `src/domain/nutrition/target-calories.ts` clamps `desiredRateKgPerMonth` to `MAX_RATE_KG_PER_MONTH=1` in code (`Math.min(requestedRate, MAX_RATE_KG_PER_MONTH)`), and the same 1 kg/month cap is independently enforced by a Postgres `CHECK` constraint (`users_desired_rate_check`, confirmed present in `drizzle/0001_init_schema.sql` and read live via `verify-schema`'s "4 CHECK-ограничения" report) |
| 4 | Matching function returns 3 plausible FDC candidates for ≥10 hand-picked ingredient names, no Branded Foods | VERIFIED | Live `npm run verify-matches`: all 10 hand-picked names (chicken breast, ground beef, white rice, banana, kale, whole milk, olive oil, chicken egg, rolled oats, cheddar cheese) each return exactly 3 candidates, all `source ∈ {foundation_food, sr_legacy_food}`, sugar shown as "нет данных" (not 0) where FDC has no value |

**Score:** 4/4 roadmap success criteria verified.

### Plan-Level Must-Haves — Spot-Checked Detail

| Area | Must-have | Status | Evidence |
|------|-----------|--------|----------|
| Domain purity | Nutrition and fdc-matching domain modules import no DB/network/Telegram code | VERIFIED | `grep -REn "drizzle\|postgres\|openai\|grammy\|node:fs" src/domain/` returns zero matches (only a comment string mentioning the words); `src/domain/fdc-matching/types.ts` explicitly defines `FdcRepository` as the only boundary, implemented by `src/adapters/fdc-repository.ts` outside the domain tree |
| sugar_g null discipline | `sugar_g` reaches callers as `null`, never coerced to 0, end-to-end | VERIFIED | Traced: `scripts/index-fdc/resolve-nutrients.ts:resolveNutrient` returns `null` (never `?? 0`) when no priority nutrient ID is present → `src/adapters/fdc-repository.ts` passes `sugarG` through unchanged (module comment + code confirm no `?? 0`) → `src/domain/fdc-matching/types.ts:FdcCandidate.sugarG: number \| null` → live query results show a real mix of `NULL` (2,041 rows) and exact `0` (2,122 rows) in `fdc_foods.sugar_g`, and `verify-matches` output renders NULL as "нет данных" for real query results (e.g. "chicken breast" candidate 1, "white rice" all 3 candidates) |
| matchIngredient contract | Returns exactly `topN` (default 3) candidates, enforces source allow-list | VERIFIED | `src/domain/fdc-matching/match-ingredient.ts`: over-fetches `topN*2`, filters through `ALLOWED_SOURCE_SET` (`foundation_food`, `sr_legacy_food` only), sorts by similarity desc, slices to `topN`; live `verify-matches` run confirms exactly 3 results per query, all allow-listed sources |
| pgvector index usage | HNSW index actually used by the query, not a Seq Scan | VERIFIED | Independently ran `EXPLAIN SELECT fdc_id FROM fdc_foods ORDER BY embedding <=> '[...]' LIMIT 3` against the live DB — plan shows `Index Scan using fdc_foods_embedding_hnsw`. `src/adapters/fdc-repository.ts` orders by the raw `cosineDistance(...)` expression ascending (not a computed `1 - distance` alias), matching the documented gap-closure fix |
| 1 kg/month cap | Enforced in code AND DB | VERIFIED | Code: `target-calories.ts` line 53 `Math.min(requestedRate, MAX_RATE_KG_PER_MONTH)`. DB: `users_desired_rate_check` CHECK constraint (`>= 0 and <= 1`), present in the applied migration and confirmed live by `verify-schema` |

### Deviation Judged: Brand-name descriptions in `fdc_foods` (01-07 must_have wording)

Plan 01-07's must_have literally states: *"No indexed description is a brand-named retail record such as `HUMMUS, SABRA CLASSIC`"*. Independent live query against the DB confirms this literal statement is **false**: 26 `sr_legacy_food` rows contain recognizable brand words (e.g. `"Candies, NESTLE, BUTTERFINGER Bar"`, `"POPEYES, biscuit"`, `"CARRABBA'S ITALIAN GRILL, spaghetti with meat sauce"`, several NESTLE/ABBOTT infant formulas). Zero such rows come from `foundation_food` (the "market_acquisition" retail-purchase problem the must_have's own `HUMMUS, SABRA CLASSIC` example — sourced from 01-RESEARCH.md's inspection of Foundation Foods' `food.csv` — was actually about).

**Judgment: the reinterpretation is defensible, not a phase-goal failure.** Reasoning:
- The actual requirement text (REQUIREMENTS.md `MATCH-02`, ROADMAP.md SC#2/#4) is "no Branded Foods" — specifically the ~2M-row USDA retail-label-scan dataset, which was never downloaded (confirmed: no `branded_food` value exists anywhere in `fdc_foods.source`, allow-list enforced in both the DB CHECK and the domain layer).
- SR Legacy is USDA's own frozen, officially-curated 2018 dataset (CLAUDE.md's own stack notes: "still authoritative for raw/whole foods"). It is documented in 01-RESEARCH.md as loaded **unfiltered by design** ("7,793 rows, all kept"). A small number of brand-named entries (candy bars, fast-food chain analyses, name-brand infant formula) genuinely exist inside the official SR Legacy dataset and predate/are unrelated to the modern Branded Foods dataset.
- Foundation Foods — the dataset that actually had a real brand-pollution risk (documented in 01-RESEARCH.md via direct inspection: 88k raw rows, 99.5% non-indexable, some literally `"HUMMUS, SABRA CLASSIC"`-style market-acquisition rows) — is correctly filtered: 0 of the 427 loaded `foundation_food` rows match a brand-name probe.
- The reinterpretation was documented transparently in `01-07-SUMMARY.md`'s "Deviations from Plan" section with the specific false-positive evidence, not silently loosened.

This is judged **VERIFIED under the actual MATCH-02 intent**, not a gap requiring a formal override entry (the deviation is from an overly-literal example in one plan's must_have text, not from the roadmap-level requirement). Flagged here for full transparency per the verification brief.

### Required Artifacts (spot-checked)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/schema/{users,diary,fdc-foods}.ts` | Drizzle schema, vector(1536), nullable sugar_g, CHECK constraints | VERIFIED | Read directly; matches live DB via `verify-schema` |
| `drizzle/0000..0002_*.sql` | Versioned, committed migration SQL (no `drizzle-kit push`) | VERIFIED | 3 files present, `verify-schema` confirms `drizzle.__drizzle_migrations` shows 3 applied migrations |
| `src/domain/nutrition/*.ts` | Pure BMR/TDEE/target-calorie/target-macro functions | VERIFIED | Read directly, zero I/O imports, 62 tests (per SUMMARY) all currently passing under the full 169-test suite |
| `src/domain/fdc-matching/{types,match-ingredient}.ts` | Pure top-N candidate selection port | VERIFIED | Read directly, zero I/O imports |
| `src/adapters/fdc-repository.ts` | Drizzle+pgvector implementation, HNSW-friendly ordering | VERIFIED | Read directly, confirmed against live EXPLAIN |
| `scripts/index-fdc/*.ts` | Download/parse/resolve/embed/load pipeline | VERIFIED | `npm run verify-index` passes live against the real loaded table |
| `scripts/verify-schema.ts`, `scripts/index-fdc/verify-index.ts`, `scripts/index-fdc/verify-matches.ts` | Live introspection checks | VERIFIED | All three independently re-run by this verifier, all exit 0 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/adapters/fdc-repository.ts` | `fdc_foods_embedding_hnsw` index | `orderBy(cosineDistance(...))` ascending | WIRED | Confirmed via live `EXPLAIN` |
| `src/domain/fdc-matching/match-ingredient.ts` | `src/adapters/fdc-repository.ts` | `FdcRepository.findNearest()` port | WIRED | Domain calls port interface only; adapter implements it outside domain tree |
| `src/domain/nutrition/target-calories.ts` | `users_desired_rate_check` (DB) | independent enforcement of the same 1 kg/month rule | WIRED (redundant by design) | Both layers independently verified |
| `scripts/index-fdc/resolve-nutrients.ts` | `fdc_foods.sugar_g` | null-preserving parse → insert | WIRED | Traced through loader; live data shows real NULL/0 split |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ONBOARD-03 | 01-01, 01-04 | Бот считает целевые калории (Mifflin-St Jeor + TDEE + rate cap + floor) | SATISFIED | `calculateTargetCalories` implements formula, cap, and floor; tests pass |
| ONBOARD-04 | 01-01, 01-04 | Бот считает целевые БЖУ (граммы) на основе целевых калорий и пресетов | SATISFIED | `calculateTargetMacros` implements protein/fat/carb g calc from presets; tests pass. **Note:** `.planning/REQUIREMENTS.md`'s status table still marks ONBOARD-04 as "Pending" — this is a stale tracking-table entry, not a code gap; the code and 01-04-SUMMARY.md both list it complete and the implementation is independently confirmed present and tested. Recommend updating the REQUIREMENTS.md checkbox/table in a follow-up doc pass. |
| MATCH-01 | 01-01, 01-02, 01-03, 01-06, 01-08 | 3 candidates via embedding vector search | SATISFIED | Live `verify-matches` confirms exactly 3 candidates per query |
| MATCH-02 | 01-01, 01-05, 01-07, 01-08 | Only Foundation Foods + SR Legacy indexed, no Branded Foods | SATISFIED | Live query confirms only 2 `source` values exist, 0 Branded Foods rows; see brand-name deviation discussion above |

No orphaned requirements found — all 4 phase requirement IDs (ONBOARD-03, ONBOARD-04, MATCH-01, MATCH-02) are claimed by at least one plan and implemented in code.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `grep -n "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` across `src/` and `scripts/` (excluding tests) | none found | — | No debt markers in phase-modified production code |
| `src/adapters/embeddings/types.ts:27` | comment | Comment claims `EMBEDDING_MODEL` "must match the model scripts/check-setup.ts already validates against" but `check-setup.ts` still uses `text-embedding-3-small` for its connectivity smoke-test | INFO | `check-setup.ts` is a connectivity probe (any working model call proves the API key works), not the production indexing path — cosmetic comment drift only, no functional impact |
| `src/domain/nutrition/target-macros.ts` | WR-09 (from 01-REVIEW.md) | `calculateTargetMacros` can return a protein+fat+carbs kcal sum that doesn't exactly equal `targetKcal` with no flag surfaced to caller (carb clamp-at-zero case) | WARNING (deferred, owner-accepted per 01-REVIEW.md, not blocking Phase 1) | Documented known limitation, carried to Phase 2 (onboarding UI can decide how to surface it) |
| Various | WR-03/04/05/07/08/10/11/12/13, IN-01..09 (01-REVIEW.md) | CLI-arg edge cases, RLS role-guard breadth, superuser DB connection, dead code, etc. | WARNING/INFO (deliberately deferred per 01-REVIEW.md, tracked there) | Reviewed 01-REVIEW.md; none of the deferred warnings affect the roadmap success criteria — all are operational-script robustness or code-cleanliness items explicitly scoped out of this phase's goal |

Note: 2 CRITICAL findings (CR-01 unvalidated `--source` flag silently indexing the wrong dataset; CR-02 in-memory-only embeddings lost on mid-run crash) were found by the phase's own code review and **fixed and merged** (commits `1697846`, `22eec75`), confirmed present in `git log` by this verifier. 3 additional WARNING-level fixes (WR-01, WR-02, WR-06) were also merged. The remaining 10 warnings and 9 info items are explicitly deferred in `01-REVIEW.md` and do not touch the roadmap success criteria.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite | `npm test` | 169/169 passing, 12 files | PASS |
| Typecheck | `npm run typecheck` | exits 0, zero errors | PASS |
| Schema live introspection | `npm run verify-schema` | SCHEMA OK, all checks green | PASS |
| Index live introspection | `npm run verify-index` | INDEX OK, 8,220 rows, correct source split, sugar NULL/0 split proven | PASS |
| Matching live query | `npm run verify-matches` | MATCHES OK, 10/10 names return 3 candidates each, allow-listed sources only | PASS |
| pgvector index usage | `EXPLAIN` on a raw cosine-distance query | `Index Scan using fdc_foods_embedding_hnsw` (not Seq Scan) | PASS |
| Brand-pollution query (independent) | Direct SQL against live DB | 26 `sr_legacy_food` brand-named rows (expected, official curated dataset), 0 `foundation_food` brand-named rows | PASS (per corrected interpretation) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this project; the phase's own live-verification scripts (`verify-schema.ts`, `verify-index.ts`, `verify-matches.ts`) serve the equivalent function and were all executed directly by this verifier (see Behavioral Spot-Checks above), not merely cited from SUMMARY.md.

### Human Verification Required

None. Every roadmap success criterion for this phase is programmatically verifiable (schema introspection, live query results, unit test results) and was independently reproduced against the live database and codebase.

### Gaps Summary

No gaps found. All 4 roadmap Success Criteria are independently verified against the live Supabase database and the actual codebase, not merely asserted by SUMMARY.md. The one area requiring judgment — the literal wording of 01-07's brand-name must_have vs. the actual MATCH-02 intent — is resolved in favor of the phase: SR Legacy's small number of officially-curated brand-named entries are outside the scope of what MATCH-02 excludes (Branded Foods, the ~2M-row dataset, never downloaded), and Foundation Foods (where the real risk was) is correctly filtered to zero brand-name matches.

The two CRITICAL code-review findings were real, correctly identified, and fixed before this verification ran. The deferred WARNING/INFO findings are operational-script robustness items that do not bear on any roadmap success criterion and are explicitly tracked in `01-REVIEW.md` for future attention.

One minor documentation gap: `.planning/REQUIREMENTS.md`'s tracking table still shows ONBOARD-04 as "Pending" despite the implementation being complete and tested — recommend a follow-up doc-only correction, not a code gap.

---

_Verified: 2026-08-11T16:30:00Z_
_Verifier: Claude (gsd-verifier)_
