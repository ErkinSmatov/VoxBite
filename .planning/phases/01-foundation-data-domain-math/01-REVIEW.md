---
phase: 01-foundation-data-domain-math
reviewed: 2026-08-11T00:00:00Z
depth: standard
files_reviewed: 44
files_reviewed_list:
  - drizzle/0000_enable_pgvector.sql
  - drizzle/0001_init_schema.sql
  - drizzle/0002_enable_rls.sql
  - scripts/check-setup.ts
  - scripts/index-fdc/build-embeddings.ts
  - scripts/index-fdc/datasets.ts
  - scripts/index-fdc/download.ts
  - scripts/index-fdc/load.test.ts
  - scripts/index-fdc/load.ts
  - scripts/index-fdc/parse-foundation.test.ts
  - scripts/index-fdc/parse-foundation.ts
  - scripts/index-fdc/parse-sr-legacy.ts
  - scripts/index-fdc/resolve-nutrients.test.ts
  - scripts/index-fdc/resolve-nutrients.ts
  - scripts/index-fdc/run.ts
  - scripts/index-fdc/verify-index.ts
  - scripts/index-fdc/verify-matches.ts
  - scripts/verify-schema.ts
  - src/adapters/embeddings/openai-embed.test.ts
  - src/adapters/embeddings/openai-embed.ts
  - src/adapters/embeddings/types.ts
  - src/adapters/fdc-repository.ts
  - src/config/env.test.ts
  - src/config/env.ts
  - src/db/client.ts
  - src/db/schema/diary.ts
  - src/db/schema/fdc-foods.ts
  - src/db/schema/index.ts
  - src/db/schema/users.ts
  - src/domain/fdc-matching/index.ts
  - src/domain/fdc-matching/match-ingredient.test.ts
  - src/domain/fdc-matching/match-ingredient.ts
  - src/domain/fdc-matching/types.ts
  - src/domain/nutrition/bmr-tdee.test.ts
  - src/domain/nutrition/bmr-tdee.ts
  - src/domain/nutrition/calculate-targets.test.ts
  - src/domain/nutrition/calculate-targets.ts
  - src/domain/nutrition/constants.ts
  - src/domain/nutrition/index.ts
  - src/domain/nutrition/target-calories.test.ts
  - src/domain/nutrition/target-calories.ts
  - src/domain/nutrition/target-macros.test.ts
  - src/domain/nutrition/target-macros.ts
  - src/domain/nutrition/types.ts
findings:
  critical: 2
  warning: 13
  info: 9
  total: 24
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-08-11
**Depth:** standard
**Files Reviewed:** 44
**Status:** issues_found

## Summary

The nutrition math, the null-vs-0 discipline, and the SQL layer are genuinely
solid. I specifically tried to break the things the phase claims as invariants
and could not: `resolveNutrient` never coalesces to 0, `resolveFoodNutrients`
refuses to fabricate an Atwater kcal from a partial macro set,
`buildNutrientIndex` correctly distinguishes `Number('') === 0` from a measured
zero, `fdc-repository.ts` orders by the raw `cosineDistance` expression (the
form Postgres can plan as an HNSW index scan) and passes every nullable
nutrient through untouched, all DB writes go through Drizzle's parameterized
builder (no string interpolation, no injection surface), the 1 kg/month cap is
enforced in `target-calories.ts` **and** as a DB `CHECK`, and no secret is
printed by any script — `maskConnectionTarget` is applied consistently and
`.env` is untracked.

The defects are concentrated in the **operational scripts**, and they cluster
around exactly the risk this project cares about most: **spending the owner's
money and then losing the result**. Two are blocking.

The single worst finding is CR-02: despite the file-level comments in `run.ts`
promising that "partial progress surviving a crash is the point" and "a
half-finished run is always safe to resume", the pipeline holds *all* ~8,200
embeddings in memory and does the one and only DB write after the last batch
returns. Any failure during Step 7 — a 429 after retries, a dropped connection,
Ctrl-C — throws away every embedding already paid for, and the closing message
tells the owner to just re-run and pay again. The documented mechanism does not
exist.

CR-01 is the other one: a typo in `--source=` does not error, it silently
selects SR Legacy (7,793 rows) instead of Foundation (469).

Beyond those, a family of CLI-argument and error-handling gaps all fail the
same way — **silently succeeding while doing nothing**, or crashing with a raw
Node stack trace instead of the owner-readable guidance the rest of the code
takes pains to provide.

## Critical Issues

### CR-01: Any unrecognized `--source=` value silently indexes SR Legacy instead of failing

**File:** `scripts/index-fdc/run.ts:56-62`
**Issue:** `selectedDatasets()` has no `else`/validation branch. The final
`return ds.source === 'sr_legacy_food'` is reached for *every* value that is
not exactly `'both'` or `'foundation'`. Verified:

```
--source=Foundation -> [sr_legacy_food]   (capitalization typo)
--source=srlegacy   -> [sr_legacy_food]
--source=fondation  -> [sr_legacy_food]
```

`RunOptions['source']` is produced by an unchecked `as` cast at line 50, so
TypeScript provides no protection. The owner intends to index 469 Foundation
rows, gets 7,793 SR Legacy rows embedded instead, and nothing in the output
says the flag was misread — Step 2 just prints "SR Legacy: ... kept". This
spends real OpenAI money on the wrong dataset and produces a wrong index.
`--source=sr-legacy` is also the documented spelling but `'sr-legacy'` only
works by falling through this same unvalidated default, so the bug is masking
the fact that the intended value is never actually matched by name.

**Fix:**
```ts
const VALID_SOURCES = ['foundation', 'sr-legacy', 'both'] as const;
type SourceOpt = (typeof VALID_SOURCES)[number];

function parseSource(raw: string | undefined): SourceOpt {
  if (raw === undefined) return 'both';
  if ((VALID_SOURCES as readonly string[]).includes(raw)) return raw as SourceOpt;
  throw new Error(
    `Неизвестное значение --source="${raw}". Допустимые: ${VALID_SOURCES.join(', ')}.`,
  );
}

function selectedDatasets(opts: RunOptions): FdcDataset[] {
  return FDC_DATASETS.filter((ds) => {
    if (opts.source === 'both') return true;
    if (opts.source === 'foundation') return ds.source === 'foundation_food';
    if (opts.source === 'sr-legacy') return ds.source === 'sr_legacy_food';
    throw new Error(`unreachable source: ${opts.source}`);
  });
}
```
Apply the same explicit validation to `--only=` in `download.ts:33-38` (see WR-03).

---

### CR-02: Paid embeddings are never persisted incrementally — a mid-run failure discards every embedding already bought

**File:** `scripts/index-fdc/run.ts:258-284` (with `scripts/index-fdc/build-embeddings.ts:28-60`)
**Issue:** Step 7 calls `buildEmbeddings(embedder, toProcess, ...)`, which loops
over *all* ~83 batches, accumulating results in the in-memory `allEmbeddings`
array, and only returns after the final batch. Step 8's `upsertFdcFoods` — the
sole DB write — runs after that. There is no write inside the loop.

Consequence: if batch 80 of 83 fails (quota exhausted mid-run, a 5xx that
outlasts the 3 retries, network drop, Ctrl-C), the process throws, the 7,900
already-billed embeddings are garbage-collected, and the catch handler at
line 351-357 prints:

> «Скрипт безопасно перезапускается: `npm run index-fdc` — уже загруженные записи будут пропущены.»

That message is false in this scenario. Nothing was loaded, so `loadExistingVersions`
skips nothing and the owner pays for all 8,200 embeddings a second time. This
directly contradicts the module's own docstring ("Never wraps the whole run in
one transaction — partial progress surviving a crash is the point, not a bug",
lines 14-16) and `load.ts`'s "(D-03: a half-finished run is safe to just
re-run)" — the resumability mechanism is documented but not implemented. It
also violates the project's cost-control invariant.

**Fix:** Move the upsert inside the embedding loop so each 100-record batch is
durable before the next API call is made. Replace Steps 7-8 with a fused
embed-then-write loop:

```ts
const CHUNK = EMBEDDING_BATCH_SIZE;
let written = 0;
for (let i = 0; i < toProcess.length; i += CHUNK) {
  const slice = toProcess.slice(i, i + CHUNK);
  const vectors = await embedder.embed(slice.map((r) => r.description));
  const rows: NewFdcFood[] = slice.map((record, j) => {
    const embedding = vectors[j];
    if (!embedding) {
      throw new Error(`Пропущен эмбеддинг для fdcId=${record.fdcId} — прерываю до записи.`);
    }
    const ds = FDC_DATASETS.find((d) => d.source === record.source);
    if (!ds) throw new Error(`Неизвестный source "${record.source}" для fdcId=${record.fdcId}`);
    return { /* ...record fields... */, embedding,
             datasetVersion: ds.datasetVersion, embeddingModelVersion: EMBEDDING_MODEL };
  });
  written += await upsertFdcFoods(db, rows);
  console.log(`batch ${i / CHUNK + 1}: записано ${fmtCount(written)}/${fmtCount(toProcess.length)}`);
}
```
This makes the closing "safe to re-run" message true, since Step 5's
version-match filter will then genuinely skip everything already written.

## Warnings

### WR-01: `embed()` can return a sparse array with `undefined` holes; neither it nor `buildEmbeddings` detects it

**File:** `src/adapters/embeddings/openai-embed.ts:143-159`, `scripts/index-fdc/build-embeddings.ts:50-59`
**Issue:** `results` is `new Array(texts.length)` and is filled only at
`results[offset + item.index]` for whatever items the response happens to
contain. There is no check that `data.length === batch.length`, and no check
that `item.index` is within `[0, batch.length)`. A short or out-of-range
response leaves holes (or writes into the wrong batch's slot).

The downstream guard does not catch this: spreading a sparse array preserves
its length (`[...new Array(3)]` has `length === 3`), so
`allEmbeddings.length !== records.length` at build-embeddings.ts:50 stays
false, and the `allEmbeddings[i] as number[]` cast at line 58 launders
`undefined` into a `number[]`. The failure then surfaces at insert time as an
opaque `null value in column "embedding" violates not-null constraint` —
after all the money was spent (and, per CR-02, with all of it lost).

**Fix:**
```ts
const data = await embedBatchWithRetry(client, batch, b, maxRetries);
if (data.length !== batch.length) {
  throw new Error(
    `OpenAI вернул ${data.length} эмбеддингов на ${batch.length} входных строк (batch ${b}).`,
  );
}
for (const item of data) {
  if (!Number.isInteger(item.index) || item.index < 0 || item.index >= batch.length) {
    throw new Error(`OpenAI вернул index=${item.index} вне диапазона batch ${b}.`);
  }
  ...
  results[offset + item.index] = item.embedding;
}
```
And in `buildEmbeddings`, assert no holes: `if (allEmbeddings.some((e) => e === undefined)) throw ...` before mapping.

---

### WR-02: A blank or non-integer `fdc_id` passes validation and collapses to `fdcId = 0`

**File:** `scripts/index-fdc/parse-foundation.ts:76-83`
**Issue:** `Number('')` and `Number('   ')` are both `0`, and `Number.isFinite(0)`
is `true`, so the malformed-row guard at line 78 lets a blank `fdc_id` through
as food id `0`. `Number('12.5')` and `Number('1e3')` are likewise finite and
pass. This is precisely the JS footgun the team correctly defended against in
`resolve-nutrients.ts:136-140` ("Number('') === 0 and Number('  ') === 0 in
JS") but did not apply here.

Impact: two or more malformed rows all become `fdcId = 0`, and
`upsertFdcFoods`'s `onConflictDoUpdate` on `fdc_id` silently overwrites them
into a single row — a corrupt index entry that is never reported. The guard's
own error message even claims it checks for "a finite **integer**", which it
does not.

**Fix:**
```ts
const rawId = record.fdc_id?.trim() ?? '';
const fdcId = Number(rawId);
if (rawId.length === 0 || !Number.isInteger(fdcId) || fdcId <= 0) {
  throw new Error(
    `Malformed row in ${foodCsvPath}: fdc_id "${record.fdc_id}" is not a positive integer.`,
  );
}
```

---

### WR-03: A typo in `--only=` makes `fdc:download` a silent no-op that exits 0

**File:** `scripts/index-fdc/download.ts:33-38, 141-158`
**Issue:** `only` is an unvalidated `as` cast. `--only=foundatoin` matches
neither `datasetKey()` result, so `targets` is empty, the loop body never runs,
and the script prints an empty `=== Итог ===` block and exits 0. The owner sees
a successful-looking run and no downloaded data, then hits a confusing "Файлы
для ... не найдены" error from a different script later.

**Fix:** Validate against `['foundation', 'sr-legacy']` and throw a message
naming the allowed values; additionally `if (targets.length === 0) throw new Error(...)`
as a backstop.

---

### WR-04: `--limit` accepts NaN and negatives, silently indexing nothing or dropping records

**File:** `scripts/index-fdc/run.ts:49, 128-130`
**Issue:** `Number(limitArg.split('=')[1])` is unvalidated.
- `--limit=abc` → `NaN`; `NaN !== undefined` is true, so `kept.slice(0, NaN)`
  returns `[]`. The run reports "0 записей" and exits 0 having done nothing.
- `--limit=-5` → `slice(0, -5)` silently drops the *last* 5 records rather than
  keeping 5.
- `--limit=0` is additionally invisible in the options echo at line 74 because
  it is tested with a truthiness check (`opts.limit ? ...`).

**Fix:**
```ts
let limit: number | undefined;
if (limitArg) {
  limit = Number(limitArg.split('=')[1]);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit должен быть целым числом >= 1 (получено "${limitArg.split('=')[1]}").`);
  }
}
```
and change the echo to `opts.limit !== undefined ? ... : ''`.

---

### WR-05: `check-setup --db-only --openai-only` prints "SETUP OK" without running a single check

**File:** `scripts/check-setup.ts:167-199`
**Issue:** Passing both flags sets `runDb = false` and `runOpenAI = false`.
`results` stays empty, the `for` loop body never executes, `allOk` remains
`true`, and the script prints `SETUP OK` and exits 0 — a false pass on a setup
that was never verified. For an owner debugging alone, a green "SETUP OK" they
cannot trust is worse than an error. (The same empty-array-is-all-true pattern
exists in `verify-schema.ts:315` and `verify-index.ts:460` via
`results.every(...)`, though those have no flag combination that reaches it
today.)

**Fix:**
```ts
if (dbOnly && openaiOnly) {
  console.error('Флаги --db-only и --openai-only взаимоисключающие. Укажи только один или ни одного.');
  process.exit(1);
}
...
if (results.length === 0) {
  console.error('Ни одна проверка не была выполнена — нечего подтверждать.');
  process.exit(1);
}
```

---

### WR-06: `verify-schema.ts` and `verify-index.ts` have no top-level error handler — the owner gets a raw Node stack trace

**File:** `scripts/verify-schema.ts:334`, `scripts/index-fdc/verify-index.ts:479`
**Issue:** Both end with a bare `main();`. Every DB call inside is unguarded
(`checkTablesExist`, `checkVectorColumn`, `checkNullability`, `checkHnswIndex`,
`checkUsersConstraints`, `checkRls`, `checkRowCount`, ...), and the `try` only
has a `finally`. A connection refusal, wrong password, or missing `pg_class`
privilege therefore escapes as an unhandled promise rejection: Node 22 prints
an unformatted `PostgresError` stack and exits with code 1.

This is the exact failure mode most likely to hit a first-time backend owner on
first run, and it bypasses all the carefully written Russian remediation text
these files otherwise contain. `verify-matches.ts:194-197` gets this right and
should be the model. `check-setup.ts` is partially exposed too: the
`postgres(databaseUrl, { max: 1 })` construction on line 109 sits *outside* its
`try`, so a `DATABASE_URL` the driver rejects outright escapes unhandled.

**Fix:**
```ts
main().catch((err) => {
  console.error(
    `\n[ОШИБКА] ${err instanceof Error ? err.message : String(err)}\n\n` +
      'Проверь DATABASE_URL в .env (пароль и адрес из Supabase Dashboard -> Connect -> Session pooler), ' +
      'затем запусти команду ещё раз.',
  );
  process.exit(1);
});
```
and move the `postgres(...)` construction inside `check-setup.ts`'s `try`.

---

### WR-07: `--json` output is not machine-parsable — human-readable logs are printed unconditionally

**File:** `scripts/verify-schema.ts:56-60`, `scripts/index-fdc/verify-index.ts:43-47, 271-283`
**Issue:** `record()` in both files does `console.log(\`${label} ${name} — ${detail}\`)`
with no `jsonMode` guard, and `checkNutrientCoverage` prints its whole coverage
table unconditionally (lines 271-283) even though `printSampleRows` right below
*is* correctly guarded by `if (!jsonMode)`. The documented purpose of `--json`
("полезно для скриптов") is defeated: `npm run verify-index -- --json | jq`
fails because plain text precedes the JSON object.

**Fix:** Thread a module-level `const jsonMode = argvHas('--json')` and guard
every `console.log` outside the final JSON emission, e.g.
`if (!jsonMode) console.log(...)` inside `record()` and around the coverage
table.

---

### WR-08: `import.meta.url === \`file://${process.argv[1]}\`` breaks on any path with a space — the script becomes a silent no-op

**File:** `scripts/index-fdc/run.ts:348`, `scripts/index-fdc/download.ts:171`
**Issue:** `import.meta.url` is a percent-encoded URL; `process.argv[1]` is a raw
filesystem path. For a checkout under e.g. `/Users/x/My Projects/VoxBite`,
`import.meta.url` is `file:///Users/x/My%20Projects/...` and the comparison is
false. `main()` never runs, `npm run index-fdc` prints nothing and exits 0. The
same applies to any non-ASCII directory name. It works on this machine only
because the current path happens to be ASCII and space-free — a latent
environment-dependent failure, and one that fails *silently*.

**Fix:**
```ts
import { pathToFileURL } from 'node:url';
...
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
```

---

### WR-09: `calculateTargetMacros` can return macros whose calorie sum exceeds `targetKcal`, with no flag for the caller

**File:** `src/domain/nutrition/target-macros.ts:26-44`
**Issue:** For a heavy user pinned at the safety floor — `calculateTargetMacros(120, 1500)`
— protein is 216 g (864 kcal) and fat is 108 g (972 kcal), totalling 1,836 kcal
against a 1,500 kcal target. `remainingKcal` is −336, the clamp turns carbs into
0, and the function returns `{ proteinG: 216, fatG: 108, carbsG: 0 }` as if it
were a valid plan that is 22% over target. `TargetMacrosResult` carries no
indicator, so Phase 2's onboarding **cannot detect this** without recomputing
the Atwater sum itself, and the user is shown mutually contradictory targets.

The code comment acknowledges the gap ("A later phase should surface a warning
... that warning is not built here"), and `target-macros.test.ts:15-18` asserts
only `carbsG === 0` without noticing the inconsistency. Documenting a silent
wrong answer does not make it correct — at minimum the result must be
self-describing.

**Fix:** Add a flag to the result type so the caller can act on it:
```ts
export interface TargetMacrosResult {
  proteinG: number; fatG: number; carbsG: number;
  /** True when protein+fat presets alone already exceed targetKcal. */
  exceedsTargetKcal: boolean;
  /** Actual kcal implied by the returned grams (differs from targetKcal when the flag is set). */
  impliedKcal: number;
}
```
Propagate it through `NutritionTargets` in `calculate-targets.ts` alongside the
existing `floorApplied`.

---

### WR-10: `users` has no range validation on `age_years`, `height_cm`, `weight_kg` — in the DB or in the domain

**File:** `drizzle/0001_init_schema.sql:5-7`, `src/db/schema/users.ts:22-24`, `src/domain/nutrition/bmr-tdee.ts:6-10`
**Issue:** The table constrains `sex`, `activity_level`, `goal` and
`desired_rate_kg_per_month` with `CHECK`s, but `age_years`, `height_cm` and
`weight_kg` accept any `integer`/`real` — including 0, −30, and 9,999.
`assertPositiveFinite` only rejects `<= 0` and non-finite, so `calculateBmr('male', 500, 30, 3)`
returns a number and the pipeline happily produces a "target" for a
physiologically impossible profile. Given the project stores health data and
the CLAUDE.md constraint that the bot must not produce unsafe guidance, the
omission stands out next to the deliberately-added rate cap.

**Fix:** Add CHECKs mirroring the constraints the domain should also enforce:
```sql
ALTER TABLE "users"
  ADD CONSTRAINT "users_age_check"    CHECK ("age_years"  BETWEEN 14 AND 100),
  ADD CONSTRAINT "users_height_check" CHECK ("height_cm"  BETWEEN 100 AND 250),
  ADD CONSTRAINT "users_weight_check" CHECK ("weight_kg"  BETWEEN 30 AND 300);
```
and replace `assertPositiveFinite` with a `assertInRange(field, value, min, max)`
so the domain rejects the same values with an owner-readable message before the
DB does.

---

### WR-11: The RLS migration's role guard checks only `anon` but revokes from `anon, authenticated`

**File:** `drizzle/0002_enable_rls.sql:24-29`
**Issue:** The `IF EXISTS (... rolname = 'anon')` guard is documented as making
the block "a no-op (does not error) on a non-Supabase Postgres instance", but
the guarded statement also references `authenticated`. On any database where
`anon` exists and `authenticated` does not, `REVOKE ... FROM anon, authenticated`
raises `role "authenticated" does not exist` and the whole migration aborts —
leaving the migration journal inconsistent and requiring manual recovery by an
owner with no backend experience. The guard does not cover what the statement
actually needs.

**Fix:**
```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "users", "diary", "fdc_foods" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "users", "diary", "fdc_foods" FROM authenticated;
  END IF;
END $$;
```

---

### WR-12: The application connects as the Supabase `postgres` superuser (BYPASSRLS) — no least-privilege app role

**File:** `src/db/client.ts:26-29`, `.env.example` (`DATABASE_URL` line), `drizzle/0002_enable_rls.sql:10-14`
**Issue:** The RLS migration's own comment states the runtime connection uses
"the `postgres` role, which carries the BYPASSRLS privilege". That is a
superuser connection used for all ordinary reads and writes, including — from
Phase 3 — request paths driven by user-supplied text. RLS is therefore not a
defence for the application path at all, only for PostgREST. Any future SQL
injection, credential leak, or a stolen `.env` yields full database control
(DROP, role creation, extension loading) rather than scoped table access.
This is a Supabase convention, not a mistake, but it is worth an explicit
decision rather than a default, and Phase 1 is the cheapest moment to change it.

**Fix:** Create a dedicated role for the bot and point `DATABASE_URL` at it:
```sql
CREATE ROLE voxbite_app LOGIN PASSWORD '<generated>';
GRANT USAGE ON SCHEMA public TO voxbite_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, diary TO voxbite_app;
GRANT SELECT ON fdc_foods TO voxbite_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO voxbite_app;
```
Keep the `postgres` connection string for `drizzle-kit migrate` and the
indexer only (a separate `DATABASE_URL_ADMIN`). If the owner prefers to defer,
record it as an accepted risk rather than leaving it implicit.

---

### WR-13: A test named for the `data_type` filter asserts a tautology and verifies nothing

**File:** `scripts/index-fdc/parse-foundation.test.ts:16-20`
**Issue:**
```ts
it('keeps ONLY rows whose data_type is foundation_food', async () => {
  const result = await parseFoundationFoods(foundationFixture);
  expect(result.foods.every((f) => true)).toBe(true);   // always true
  expect(result.foods).toHaveLength(2);
});
```
`every((f) => true)` is unconditionally `true` for any input including `[]`, and
`f` is unused. The only real assertion is the length. Since `RawFood` does not
carry `data_type`, the property this test is named for is genuinely untestable
in its current form — which matters, because CR-01/MATCH-02 make this filter
the guard against thousands of brand-named rows entering the index. A test that
looks like it covers the filter but does not is worse than no test.

**Fix:** Assert the observable consequence instead, and drop the tautology:
```ts
expect(result.foods.map((f) => f.fdcId).sort()).toEqual([2000001, 2000002]);
expect(result.foods.every((f) => f.source === 'foundation_food')).toBe(true);
expect(Object.keys(result.skippedByDataType).sort())
  .toEqual(['agricultural_acquisition', 'market_acquisition', 'sample_food', 'sub_sample_food']);
```

## Info

### IN-01: Dead `wantedFdcIds` set and redundant `allKept` initialization in `run.ts`

**File:** `scripts/index-fdc/run.ts:98, 132-134, 97, 198`
**Issue:** `wantedFdcIds` is populated in the Step 2 loop and never read
anywhere (Step 3 builds its own per-dataset `idsForDataset` set). `allKept` is
initialized to `[]` at line 97 and unconditionally reassigned at line 198.
**Fix:** Delete `wantedFdcIds` entirely; declare `const allKept = allCandidates.filter(isIndexable)` at its point of use.

---

### IN-02: `MAX_RATE_KCAL_PER_DAY` is exported but used only by tests

**File:** `src/domain/nutrition/constants.ts:79-81`
**Issue:** No production code imports it; `target-calories.ts` recomputes the
same value inline as `(rateKgPerMonth * KCAL_PER_KG_BODY_MASS) / DAYS_PER_MONTH`.
`target-calories.test.ts` then asserts against the constant, so the test and
the implementation derive from the same inputs by two different code paths —
weakening the "hand-computed expectation" intent.
**Fix:** Either use the constant in `target-calories.ts` for the default-rate
case, or delete it and let the test assert the literal `257`.

---

### IN-03: Double batching — `buildEmbeddings` chunks by 100, then `embed()` chunks by 100 again

**File:** `scripts/index-fdc/build-embeddings.ts:38-48` vs `src/adapters/embeddings/openai-embed.ts:142`
**Issue:** Harmless today (the inner chunk is always a no-op passthrough of a
100-element array), but it means the batch-size invariant lives in two places
and a future change to one is silently absorbed by the other.
**Fix:** Have `buildEmbeddings` call `embedder.embed(texts)` once and take
progress from a callback on the adapter, or drop the adapter's internal
chunking and make batching the caller's job — one owner, not two.

---

### IN-04: Duplicate import statement from the same module

**File:** `scripts/index-fdc/verify-matches.ts:19-20`
**Issue:** `createOpenAIEmbedder` and `estimateEmbeddingCostUsd` are imported
from `openai-embed.js` in two consecutive statements.
**Fix:** Merge into one import.

---

### IN-05: Inconsistent relative-import style (`./types.js` vs `./types`)

**File:** `src/domain/nutrition/*` and `src/db/schema/index.ts` (extensionless) vs `src/domain/fdc-matching/match-ingredient.ts` and all of `scripts/` (`.js`)
**Issue:** Both resolve correctly under `moduleResolution: "Bundler"` + `tsx`,
so this is not a runtime bug — but if the project ever moves to `NodeNext`
resolution or emits real JS (`noEmit` is currently true), the extensionless
half breaks. `src/db/schema/diary.ts:12` imports `'./users'` while
`scripts/index-fdc/load.ts:14` imports `'.../fdc-foods.js'`.
**Fix:** Standardize on `.js`-suffixed specifiers everywhere.

---

### IN-06: `process.exit()` immediately after `console.log` can truncate piped output

**File:** `scripts/check-setup.ts:199,202`, `scripts/verify-schema.ts:331`, `scripts/index-fdc/verify-index.ts:476`, `scripts/index-fdc/run.ts:350`
**Issue:** When stdout is a pipe (not a TTY), writes are asynchronous;
`process.exit()` does not flush them. `npm run verify-index -- --json > out.json`
can produce a truncated file.
**Fix:** Set `process.exitCode = allOk ? 0 : 1` and let the process end
naturally (all DB pools are already closed in `finally`).

---

### IN-07: `dailyDelta` is rounded mid-pipeline, contradicting the "round once at the end" convention

**File:** `src/domain/nutrition/target-calories.ts:55`
**Issue:** `bmr-tdee.ts:14-16` explicitly documents "rounding happens once, at
the end of the calculation pipeline, so intermediate error does not accumulate",
but `Math.round` is applied to `dailyDelta` before the subtraction and again to
the result. The magnitude is under 0.5 kcal, so this is a consistency note, not
a correctness bug.
**Fix:** Drop the inner `Math.round` and let the single `Math.round(raw)` at the
end do the work (adjust the two tests that assert against the pre-rounded
`MAX_RATE_KCAL_PER_DAY`).

---

### IN-08: `explainError`'s fall-through returns the raw driver message

**File:** `scripts/check-setup.ts:68, 83`
**Issue:** For unmatched errors the raw `err.message` is interpolated into the
output. Neither postgres.js nor the OpenAI SDK put credentials in `message`, so
this is not a leak today — but it is the one path in these scripts that emits
untransformed third-party text, and it is also the least useful output for the
target audience.
**Fix:** Keep the raw message but append a fixed next step, e.g.
`+ '\n(Если непонятно — скопируй эту строку и покажи её, не публикуй содержимое .env.)'`.

---

### IN-09: `FdcDataset.foodCsv` / `foodNutrientCsv` are permanently-wrong dead fields

**File:** `scripts/index-fdc/datasets.ts:31-34, 54-55`
**Issue:** These two fields are documented as "best-effort defaults only" and
are never read by any consumer — `download.ts` and `run.ts` both call
`findFileRecursive` / `resolveExtractedCsvPaths` instead. They are guaranteed
to point at a non-existent path (the archives always unpack into a nested
version-named folder), so any future code that trusts the interface will break.
**Fix:** Remove both fields from `FdcDataset` and from `dataset()`; the resolver
functions are the only correct source.

---

_Reviewed: 2026-08-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
