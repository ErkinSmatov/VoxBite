---
phase: 01-foundation-data-domain-math
slug: 01-foundation-data-domain-math
status: verified
threats_total: 28
threats_closed: 28
threats_open: 0
asvs_level: 1
created: 2026-08-11
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|----------------|
| Developer machine -> git remote | Secrets (Supabase DB password, OpenAI key) must never cross this boundary | `.env` contents |
| Local process -> Supabase Postgres (TLS) | Credentials + user health data in transit | `DATABASE_URL`, query rows |
| Local process -> OpenAI API (HTTPS) | API key in transit; billable calls | API key, ingredient/food description text |
| Supabase PostgREST (`anon` key) -> `public` schema tables | Supabase auto-publishes every public-schema table over the internet | `users`, `diary`, `fdc_foods` rows |
| USDA CDN (external HTTP) -> local disk | Downloaded archive contents outside project control | Foundation Foods / SR Legacy CSV bundles |
| Ingredient text (future: LLM output, user speech) -> embedding -> vector query | Untrusted text reaches the query path | 1536-dim embedding vector (never raw text) into SQL |
| `fdc_foods` contents -> user-facing candidate list | Whatever is in the table is shown to the user as authoritative nutrition data | kcal/protein/fat/carbs/sugar per candidate |

---

## Threat Register

All 28 threats were independently re-verified against the implemented code (and, where the register's own `<verify_with_extra_scepticism>` note flagged prior breakage, against the **live** database/EXPLAIN output, not just source text) rather than accepted on the plans' or SUMMARY.md's own word.

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-01-02 | Info Disclosure | `.env`, `.env.example`, `check-setup.ts` | mitigate | `.gitignore:2-4` (`.env`, `.env.*`, `!.env.example`); `git ls-files` confirms `.env` is untracked, only `.env.example` (placeholders only) is; `check-setup.ts:32-40,86-138` `maskConnectionTarget()` prints host:port only, never full connection string or key | closed |
| T-01-03 | DoS (owner's budget) | `openai-embed.ts`, `run.ts`, `build-embeddings.ts`, `check-setup.ts`, `verify-matches.ts` | mitigate | `openai-embed.ts:145-188` sequential `for` loop (no `Promise.all`), `isRetryable()` excludes `insufficient_quota`; `run.ts:298-306` prints cost/call-count before spending; `run.ts:56-112` `--dry-run`/`--limit`; `load.ts:46-63`+`run.ts:274-296` version-based skip so a clean re-run costs $0 (confirmed live: `npm run verify-index` shows a stable 8,220-row index, no re-embed). Note: this threat's plan-level mitigation *was* found broken by code review (CR-02, in-memory buffering discarded paid-for embeddings on crash) — re-verified as **fixed**: `build-embeddings.ts:66-109` (`embedAndStore`) writes each 100-record batch via `writeBatch` before requesting the next batch, and `run.ts:319-355` wires that into `upsertFdcFoods` per batch, matching the code comment's claim | closed |
| T-01-04 | Info Disclosure | Postgres/OpenAI TLS, `client.ts`, `verify-schema.ts`, `verify-index.ts` | mitigate | `.env.example` DATABASE_URL ends in `?sslmode=require`; `grep -rn "rejectUnauthorized: false"` across `src/`,`scripts/` — zero matches; `verify-index.ts:34-41`, `check-setup.ts:33-40` mask connection string to host:port in all console output | closed |
| T-01-05 | Tampering (misconfig) | `src/config/env.ts` | mitigate | `env.ts:39-60` `loadEnv()` calls `dotenvSafe.config({ example: '.env.example', allowEmptyValues: false })`, then an explicit `REQUIRED_ENV_KEYS` filter throws a named-key, remediation-bearing error (`buildMissingKeysMessage`) on any missing/empty required var | closed |
| T-01-06 | DoS (owner's budget) | `check-setup.ts` | accept | `check-setup.ts:141-164` `checkOpenAI()` issues exactly one `embeddings.create` call with a 4-token input string and prints the (near-zero) cost | closed (accepted risk documented below) |
| T-01-07 | Spoofing | Supabase DB password | mitigate | `.env.example` documents Session Pooler + `sslmode=require`; `env.ts`/`.gitignore` keep the password out of git; password storage in a password manager is a process control outside code — treated as satisfied per the plan's own mitigation text (process, not code, artifact) | closed |
| T-01-08 | DoS (availability) | Supabase free-tier auto-pause | accept | Documented risk with "Restore project" remedy in Plan 01-02; acceptable for closed beta per plan disposition | closed (accepted risk documented below) |
| T-01-10 | Info Disclosure | `users`/`diary` via PostgREST + anon key | mitigate | `drizzle/0002_enable_rls.sql:14-16` enables RLS on all 3 tables with zero policies (deny-all); lines 24-29 revoke grants from `anon`/`authenticated`; `verify-schema.ts:259-276` asserts `pg_class.relrowsecurity` true for all 3 — live-confirmed via `01-VERIFICATION.md`'s reproduced `npm run verify-schema` run | closed |
| T-01-11 | Tampering (destructive) | drizzle-kit workflow | mitigate | `drizzle.config.ts:6-10,21` bans `push` in comment + `strict: true`; `package.json` scripts only expose `db:generate`/`db:migrate`/`db:studio` (`push` absent, confirmed via grep); `grep -n "DROP TABLE\|DROP COLUMN" drizzle/*.sql` — zero matches | closed |
| T-01-12 | Tampering (integrity) | `users` profile columns | mitigate | `drizzle/0001_init_schema.sql:19-22` + `src/db/schema/users.ts:42-51` — Postgres `CHECK` constraints on `sex`, `activity_level`, `goal`, and `desired_rate_kg_per_month between 0 and 1` | closed |
| T-01-13 | Repudiation (drift) | schema vs code | mitigate | `verify-schema.ts:88-109` queries `drizzle.__drizzle_migrations` and asserts row count matches the committed migration files | closed |
| T-01-14 | Tampering (input) | nutrition public functions | mitigate | `bmr-tdee.ts:6-9` `assertPositiveFinite()` guards weight/height/age/bmr; `target-calories.ts:35-37,45-49` validates `tdee` and `desiredRateKgPerMonth` are finite; each throws a field-named `Error` | closed |
| T-01-15 | Tampering (bypass) | `desiredRateKgPerMonth` | mitigate | `target-calories.ts:53` `Math.min(requestedRate, MAX_RATE_KG_PER_MONTH)` clamps in-code; DB `users_desired_rate_check` (T-01-12) is the second layer — both independently confirmed live in 01-VERIFICATION.md | closed |
| T-01-16 | DoS (user health) | calorie floor | mitigate | `target-calories.ts:58-67` applies `CALORIE_FLOOR_MALE`/`CALORIE_FLOOR_FEMALE` after the rate adjustment for `goal==='loss'`, returns `floorApplied` boolean | closed |
| T-01-17 | Info Disclosure | domain layer | accept | `grep -REn "drizzle|postgres|openai|grammy|node:fs" src/domain/` returns zero real matches (01-VERIFICATION.md); domain modules are pure, in-memory, no logging | closed (accepted risk documented below) |
| T-01-18 | Tampering (integrity) | `parse-foundation.ts` filter | mitigate | `parse-foundation.ts:104-112` named constant `FOUNDATION_DATA_TYPE = 'foundation_food'`; `run.ts:181-186` aborts the whole run if kept-count > `FOUNDATION_KEPT_SANITY_LIMIT` (5,000); live-confirmed 427 kept (well under limit) | closed |
| T-01-19 | Tampering (corruption) | `resolve-nutrients.ts` | mitigate | `resolveNutrient()` (`resolve-nutrients.ts:59-70`) returns `null`, never `0`, when no priority ID is found; `grep -n "?? 0" scripts/index-fdc/resolve-nutrients.ts` — zero matches; `duplicateCount`/`unparsableAmountCount` surfaced (lines 122-160) | closed |
| T-01-20 | Tampering (zip-slip) | `download.ts` unzip | accept | Extraction target is git-ignored `data/fdc/<name>`, source is a USDA government HTTPS endpoint, never executed — plan-level accepted risk | closed (accepted risk documented below) |
| T-01-21 | Info Disclosure | downloaded datasets in git | mitigate | `.gitignore:5` `data/`; `git ls-files \| grep '^data/'` returns nothing | closed |
| T-01-22 | Injection | CSV descriptions into SQL | mitigate | `load.ts:84-113` `upsertFdcFoods()` uses Drizzle's `.insert().values().onConflictDoUpdate()` builder exclusively; `grep -n "INSERT INTO" scripts/index-fdc/load.ts` — zero raw-SQL matches (the only `sql\`...\`` usages are `excluded.column` references and `now()`, still parameterized by the builder) | closed |
| T-01-23 | Tampering (index corruption) | mixed embedding models in one HNSW index | mitigate | `fdc-foods.ts` stores `embeddingModelVersion`+`datasetVersion` per row; `load.ts:46-63` `loadExistingVersions()` compares both before skipping; `verify-index.ts:370-399` `checkVersionStamping()` fails if >1 distinct model present. **Live-reconfirmed** (per the model-swap scepticism note): `npm run verify-index` run during this audit shows a single model (`text-embedding-3-large`) across both dataset_version groups (2018-04/427 rows, 2026-04-30/7,793 rows) — no old `text-embedding-3-small` rows remain | closed |
| T-01-24 | Tampering (MATCH-02) | `run.ts` / loaded contents | mitigate | `run.ts:181-186` hard abort on Foundation kept-count > 5,000; `verify-index.ts:94-193` `checkSourceValues()`+`checkBrandPollution()` assert only `foundation_food`/`sr_legacy_food` and run a brand-name probe. Live re-run during this audit: 0 brand-named `foundation_food` rows, 26 in `sr_legacy_food` (judged acceptable per 01-VERIFICATION.md's documented deviation analysis — official curated SR Legacy dataset, not Branded Foods) | closed |
| T-01-25 | Info Disclosure | embedder error logs | mitigate | `openai-embed.ts:111,115` log only `batchIndex`/attempt counts; `toOwnerMessage()` (lines 73-86) never echoes API key; no call site logs `batch`/embedded text | closed |
| T-01-26 | Tampering (silent zeroing) | `sugar_g` semantics | mitigate | `verify-index.ts:306-328` `checkNutrientCoverage()` fails if sugar coverage is 0% or 100%; `verify-index.ts:331-368` `checkZeroVsNullSugar()` requires NULL to be >5% of the NULL-or-zero bucket. Live re-run: sugar coverage 75.2%, NULL=2,041 vs exact-zero=2,122 — both checks pass for real reasons, not vacuously | closed |
| T-01-27 | Tampering (MATCH-02 at read) | `matchIngredient` | mitigate | `match-ingredient.ts:40,54-63` over-fetches `topN*2`, filters via `ALLOWED_SOURCE_SET` before slicing; `match-ingredient.test.ts:83` unit-tests a `branded_food` row is filtered; `verify-matches.ts:150-155` re-asserts every live candidate's `source` is in `ALLOWED_SOURCES`. Live re-run: 10/10 hand-picked names return only allow-listed sources | closed |
| T-01-28 | Tampering (nutrient falsification) | `fdc-repository.ts` mapping | mitigate | `fdc-repository.ts:55-69` passes `kcal`/`proteinG`/`fatG`/`carbsG`/`sugarG` through untouched from the query row; `grep -n "?? 0" src/adapters/fdc-repository.ts` — zero matches; `match-ingredient.ts` performs no arithmetic on these fields | closed |
| T-01-29 | Injection | vector query from untrusted text | mitigate | `fdc-repository.ts:26,34` uses Drizzle's `cosineDistance(fdcFoods.embedding, embedding)` with `embedding: number[]` as a bound parameter — no string interpolation of ingredient text anywhere in the query path; text is embedded to a vector before this function is ever called | closed |
| T-01-30 | DoS (performance) | `findNearest` | mitigate | `fdc-repository.ts:34,52-53` orders by the raw `cosineDistance(...)` expression ascending (not the computed `similarity` alias) with `.limit(limit)`. **This threat's plan-level mitigation was previously VIOLATED** (a `1 - distance` alias defeated the HNSW planner, causing a full Seq Scan) and fixed in commit `35ac9f3`. Independently re-verified in this audit with a fresh live `EXPLAIN SELECT fdc_id FROM fdc_foods ORDER BY embedding <=> '<zero-vector>' LIMIT 3` against the real database: plan shows `Index Scan using fdc_foods_embedding_hnsw`, not `Seq Scan` — confirmed genuinely fixed, not just per commit message | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|--------------|------|
| AR-01 | T-01-06 | `check-setup.ts` issues exactly one ~4-token embedding call per invocation (cost < $0.000001, printed in output) — negligible, repeated-run-safe budget exposure | Plan 01-01 (planning-time) | 2026-08-11 |
| AR-02 | T-01-08 | Supabase free-tier project auto-pauses after ~7 days idle; "Restore project" remedy documented for the owner; acceptable availability risk for a closed beta with no uptime SLA | Plan 01-02 (planning-time) | 2026-08-11 |
| AR-03 | T-01-17 | Nutrition domain functions are pure, in-memory, perform no I/O/logging — nothing to disclose at this layer even though they process health data | Plan 01-04 (planning-time) | 2026-08-11 |
| AR-04 | T-01-20 | `download.ts`'s unzip step accepts zip-slip risk from the USDA archive: source is a trusted US-government HTTPS endpoint, extraction target is git-ignored and never executed, and the step runs once on a developer machine, not in any user-facing or production request path | Plan 01-05 (planning-time) | 2026-08-11 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|----------------|--------|------|--------|
| 2026-08-11 | 28 | 28 | 0 | Claude (gsd-security-auditor) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-11

---

## Unregistered Flags (informational, non-blocking)

No `## Threat Flags` entries from any of the 8 plans' SUMMARY.md files map to new, unmapped attack surface — `01-01`, `01-02`, `01-05`, `01-06`-SUMMARY.md have no `## Threat Flags` section content (nothing to flag); `01-03`, `01-04`, `01-07`, `01-08`-SUMMARY.md explicitly state "None" with justification tied back to the plan's own registered threat IDs.

One residual item **not** in the 28-threat register but visible in `01-REVIEW.md` (WR-12) is flagged here for transparency, not as a blocker: the application's runtime DB connection (`src/db/client.ts`) uses the Supabase `postgres` superuser role, which carries `BYPASSRLS` — meaning RLS (T-01-10's mitigation) protects only the PostgREST/anon-key path, not the application's own connection. This was deliberately deferred by the code review (WR-12, warning-level, not fixed) rather than raised as a phase threat, and is worth registering as a threat in Phase 2 or 3 once the app makes its first request-driven (potentially attacker-influenceable) query, since a future SQL-injection or credential leak on that connection would bypass RLS entirely. Not blocking Phase 1 sign-off — no user-facing request path exists yet in this phase.

---

_Audited: 2026-08-11_
_Auditor: Claude (gsd-security-auditor)_
