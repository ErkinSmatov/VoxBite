# Phase 1: Foundation — data + domain math - Research

**Researched:** 2026-08-10
**Domain:** Postgres/pgvector schema on Supabase, offline USDA FDC bulk-CSV indexing pipeline, pure-function nutrition domain math (Mifflin-St Jeor/TDEE/macros)
**Confidence:** HIGH — every load-bearing claim below was either verified by downloading and inspecting the actual current USDA FDC CSV bundles, fetched from current official docs (Supabase, Drizzle, OpenAI), or confirmed via live `npm view` registry queries. Only the exact Supabase/OpenAI dashboard click-paths (UI copy, not behavior) are MEDIUM, since UI wording can drift between this research date and execution.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Hosting):** Postgres is hosted on a managed cloud provider (Supabase),
  not local Docker — owner has no backend infra experience, wants to avoid
  local Postgres/extension setup and prefers seeing data in a web UI.
  Planner/executor must produce step-by-step Supabase project setup
  instructions (create project, enable `pgvector`, get connection string,
  where to put it in `.env`) as part of this phase's deliverables.
- **D-02 (API providers):** Owner has no existing API accounts for
  STT/LLM/embeddings — starting from zero. Use OpenAI for the embedding
  provider in this phase (`text-embedding-3-small`, per research/STACK.md)
  since it's the cheapest and simplest to set up, and this account will
  likely be reused for LLM dish-decomposition in Phase 3. The plan must
  include detailed instructions for creating an OpenAI account, generating
  an API key, and adding billing (with an explicit spend-limit/budget-cap
  recommendation, since owner has no experience monitoring API costs).
- **D-03 (FDC indexing invocation):** The one-time USDA FDC indexing pipeline
  is invoked as a simple terminal command (e.g. `npm run index-fdc`), not a
  UI or automated CI job. Owner will run it manually once (and again only if
  the FDC dataset is refreshed). The plan must document exactly what to
  type, what successful output looks like, and what to do if it fails
  partway (safe to re-run / idempotent, per PITFALLS.md).
- **D-04 (Macro preset ratios):** Exact protein/fat gram-per-kg ratios for
  the target-macro calculation (TECH_SPEC.md §6.4 gives ranges: protein
  1.6–2.0 g/kg, fat 0.8–1.0 g/kg) are Claude's discretion. Use reasonable
  defaults — protein **1.8 g/kg** body weight, fat **0.9 g/kg** body weight,
  carbs = remainder of target calories — and document the chosen constants
  clearly in code (comment or named constants) so they're easy to find and
  adjust later. Not a locked nutritional claim — a documented, changeable
  default.

### Claude's Discretion

- Exact Postgres schema field names/types, migration tool choice (per
  research/STACK.md: Drizzle ORM), and internal module structure for the
  domain layer (nutrition math, FDC matching) — follow
  research/ARCHITECTURE.md's hexagonal boundary guidance (domain layer has
  zero Telegram/DB-driver imports).
- Exact BMR/TDEE/macro-preset constants beyond the protein/fat ratios above
  (e.g. calorie safety floor exact values — TECH_SPEC.md §6.3 already
  specifies ~1200/1500 kcal as reference floors).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ONBOARD-03 | Bot considers target calories via Mifflin-St Jeor + TDEE + rate cap + safety floor (TECH_SPEC §6.3) | §"Mifflin-St Jeor + TDEE + rate cap: verified formula and edge cases" below — exact constants verified, rounding/floor-collision edge cases enumerated, Vitest table-driven test pattern provided |
| ONBOARD-04 | Bot computes target БЖУ (grams) from target calories + goal presets (TECH_SPEC §6.4) | Same section — named/adjustable constants pattern (`PROTEIN_G_PER_KG = 1.8`, `FAT_G_PER_KG = 0.9`) per D-04, carbs-as-remainder edge case (can go negative if floor is very low + high protein/fat person — must clamp) |
| MATCH-01 | Each dish component matched to 3 FDC candidates via embedding vector search | §"Drizzle + pgvector: schema and query syntax" + §"Don't Hand-Roll" — verified `vector()` column type, HNSW index syntax, `cosineDistance()` query builder API |
| MATCH-02 | Index only Foundation Foods + SR Legacy, no Branded Foods | §"USDA FDC bulk download: verified file structure and critical filtering gotcha" — **the single most important finding in this research**: Foundation Foods' own `food.csv` is only 0.5% "real" foundation-food rows; the rest is supporting sample data that looks brand-polluted and must be filtered out, or MATCH-02's intent is silently violated even without touching Branded Foods at all |
</phase_requirements>

## Summary

This phase has three deliverables — a Postgres/pgvector schema on Supabase, an
offline FDC indexing script, and a pure nutrition-math domain layer — and all
three have concrete, verifiable specifics that materially change how the plan
should be written.

The most consequential finding came from actually downloading and inspecting
the current (2026-04-30) Foundation Foods and SR Legacy CSV bundles rather
than trusting documentation summaries: **Foundation Foods' `food.csv` contains
88,314 rows, but only 469 of them (0.5%) have `data_type = "foundation_food"`
— the true, queryable "foundation food" records.** The remaining 99.5% are
supporting `sample_food` / `market_acquisition` / `sub_sample_food` /
`agricultural_acquisition` rows (individual lab samples and even
brand-labeled retail purchases like "HUMMUS, SABRA CLASSIC" used as raw
inputs to compute the foundation-food aggregate). If the indexing script
naively indexes every row of `food.csv`, MATCH-02's intent ("no Branded
Foods") is violated in spirit even though the code never touches the actual
Branded Foods dataset. **This must be an explicit `WHERE data_type =
'foundation_food'` filter in the indexing pipeline, not an assumption.**

The second major finding is that **nutrient field coverage differs sharply
between the two datasets and is incomplete in both** — verified by counting
actual nutrient rows per food, not by reading documentation. SR Legacy has
100% coverage for calories/protein/fat/carbs via nutrient IDs `1008/1003/
1004/1005`, and 77% sugar coverage via nutrient ID `2000`. Foundation Foods
covers protein/fat/carbs at 80-91%, sugar at only 39% (via nutrient ID
`1063`, **not** `2000` — `2000` covers just 1.1% of Foundation Foods), and
the legacy "Energy" field (`1008`) at only 29% — Foundation Foods mostly
reports calories via `2047`/`2048` (Atwater factor variants) instead. A
correct indexing pipeline needs a **priority-ordered nutrient-ID lookup**
per field, not a single hardcoded ID, and must leave a field `null` (never
`0`) when none of the candidate IDs are present — directly serving
PITFALLS.md's Pitfall 7 and TECH_SPEC §5.8.

Supabase, Drizzle+pgvector, and OpenAI setup are all well-documented and
verified against current official sources: use the **Session Pooler**
connection string (not Direct Connection, not Transaction Pooler) as the
default `DATABASE_URL` for both `drizzle-kit` migrations and the indexing
script, since it works from a typical home/office IPv4-only network and
(unlike Transaction Pooler) supports the prepared statements Drizzle
migrations need. OpenAI's spend-limit UX changed materially in 2026 — as of
this research date, **hard spend limits are back** (restored the week of
2026-07-22, after a period where the budget field was notification-only) —
so the "spend cap" instruction the owner needs is concrete and enforceable
again, not just a wishful alert.

**Primary recommendation:** Build the FDC indexing pipeline around a
verified, explicit nutrient-ID priority table and an explicit
`data_type = 'foundation_food'` filter for the Foundation Foods source (SR
Legacy needs no such filter — every row there is already `sr_legacy_food`);
wire Drizzle's native `vector()` column + HNSW index exactly as shown in
Drizzle's own guide; and keep the domain math layer as plain, zero-I/O
TypeScript functions tested with Vitest `test.each` tables covering every
sex × goal × activity-level combination plus the floor-collision and
carbs-can't-go-negative edge cases.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Postgres schema (`users`, `diary` stub, `fdc_foods`) | Database/Storage | — | Schema is the data model; owned by the DB layer, defined via Drizzle schema files that live with `db/` |
| Offline FDC indexing pipeline (download → filter → parse → embed → load) | Standalone CLI script (own tier, not the request-serving backend) | Database/Storage (write target) + API/Backend (embedding adapter call) | One-time/rare batch job explicitly kept out of the runtime bot process (ARCHITECTURE.md Anti-Pattern 3); it borrows the embedding adapter from the future backend tier but is not itself a backend service |
| Embedding generation (OpenAI `text-embedding-3-small` call) | API/Backend (adapter, `adapters/embeddings/`) | — | External API call wrapped behind a narrow interface so runtime matching and the offline indexer share one implementation |
| Vector similarity search (FDC candidate matching) | Database/Storage (pgvector `<=>` query, executed in Postgres) | Domain (pure function wrapping a repository port, per ARCHITECTURE.md Pattern 3) | The SQL/index work happens in Postgres; the domain layer only owns *which* candidates to keep/shape (top-N), not how the vector search executes |
| BMR/TDEE/target-calorie/macro calculation | Domain (pure function, zero I/O) | — | Deterministic math with no external dependency — the most unit-testable, highest-priority-to-get-right part of the whole product per PROJECT.md's Core Value |
| Macro preset constants (protein/fat g-per-kg) | Domain (named exported constants) | — | Per D-04, these are documented, changeable defaults living in code, not a database-backed config table (no admin UI exists or is planned for v1) |

## Standard Stack

### Core

| Library | Version (verified via `npm view`, 2026-08-10) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 | Schema definition, query builder, migrations | Already locked in research/STACK.md; 0.45.x has native `vector()` pg-core column type and `cosineDistance()`/`l2Distance()` helpers (added 0.36+) — no custom type needed |
| `drizzle-kit` | 0.31.10 | Migration generation/execution CLI | `generate`, `migrate`, `push`, `studio` commands; use `generate`+`migrate` for this phase, never `push` (no confirmation, no history, can silently drop columns) |
| `pg` | 8.23.0 | Postgres driver | Works with Drizzle's `drizzle-orm/node-postgres` adapter; alternative is `postgres` (postgres.js) per Drizzle's own Supabase guide, either works — pick one and use it consistently for the app + the indexing script |
| `csv-parse` | 7.0.2 | Streaming CSV parser for the FDC bulk files | `food_nutrient.csv` in the Foundation Foods bundle alone is ~10MB with ~200k rows (SR Legacy's is ~36MB) — streaming avoids loading it fully into memory |
| `openai` | 7.4.0 | Direct OpenAI SDK for embeddings | Use `client.embeddings.create()` directly (not via the AI SDK abstraction, per STACK.md) — same adapter code is shared between the offline indexer and (later) runtime ingredient matching |
| `vitest` | 4.1.10 | Unit test runner | `test.each` gives clean table-driven coverage of sex × goal × activity-level combinations |
| `dotenv-safe` | latest (already recommended in STACK.md) | Env var loading with fail-fast on missing required vars | Surfaces a missing `DATABASE_URL`/`OPENAI_API_KEY` immediately instead of as a cryptic runtime error — important for a backend-first-timer debugging alone |
| `tsx` | latest | Run TypeScript scripts directly (`tsx scripts/index-fdc/run.ts`) | Avoids a manual `tsc` build step for the one-off indexing script and for local Vitest/dev runs |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pgvector` (npm, from the pgvector project) | latest | Optional helper for hand-written raw-SQL vector formatting | Not required for Drizzle inserts/queries — Drizzle's native `vector()` column accepts a plain `number[]` directly on both insert and in `cosineDistance()`. Only reach for this package if a raw-SQL `COPY`/bulk-insert path is used instead of Drizzle's query builder for performance during the one-time load |
| `zod` | 4.4.x (already in STACK.md) | Optional input validation for the domain layer's public function signatures (e.g. onboarding profile shape) | Not strictly required for pure functions with TS types alone, but consistent with the project's later Zod usage (LLM structured output) — Claude's discretion whether to add it in this phase or defer to Phase 2 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Drizzle's native `vector()` column type | `pgvector` npm helper + `customType()` | Only needed pre-Drizzle-0.36; current 0.45.2 makes this unnecessary — do not add extra indirection |
| Session Pooler connection (port 5432) for migrations/indexing | Direct Connection (port 5432, `db.<ref>.supabase.co`) | Direct Connection has zero pooler overhead and is Supabase's own recommendation for "persistent servers" — use it instead **only if** the owner's network/ISP has IPv6 (Direct Connection is IPv6-only unless the paid IPv4 add-on is purchased); otherwise Session Pooler is the correct default |
| `drizzle-kit generate` + `migrate` (versioned migration files) | `drizzle-kit push` | `push` is fine for rapid local iteration but produces no migration history and can silently drop columns — do not use it as the phase's documented workflow, even though it's faster to type |

**Installation:**
```bash
npm install drizzle-orm pg openai csv-parse dotenv-safe
npm install -D drizzle-kit vitest tsx typescript @types/node @types/pg
```

**Version verification:** Confirmed live via `npm view <pkg> version` on 2026-08-10:
`drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `pg@8.23.0`, `openai@7.4.0`,
`vitest@4.1.10`, `csv-parse@7.0.2`. These match/refine the versions already
cited in research/STACK.md (drizzle-orm 0.45.x, etc.) — no drift found.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  USDA FDC bulk downloads (external, one-time fetch)                  │
│  Foundation Foods CSV zip  +  SR Legacy CSV zip                      │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │ download.ts (fetch + unzip)
┌────────────────────────────────▼──────────────────────────────────────┐
│  scripts/index-fdc/  (offline CLI, `npm run index-fdc`)                │
│                                                                        │
│  parse food.csv (stream) ──► FILTER:                                  │
│    Foundation Foods: WHERE data_type = 'foundation_food'  (469 rows)  │
│    SR Legacy:        no filter needed (all rows are sr_legacy_food)   │
│         │                                                              │
│         ▼                                                              │
│  join food_nutrient.csv on fdc_id, resolve each field via a           │
│  PRIORITY-ORDERED nutrient-ID list (verified coverage table below)    │
│         │                                                              │
│         ▼                                                              │
│  batch embed food descriptions (OpenAI text-embedding-3-small,        │
│  ~100 per API call) ──► adapters/embeddings (shared with runtime)     │
│         │                                                              │
│         ▼                                                              │
│  idempotent upsert (ON CONFLICT fdc_id DO UPDATE) into fdc_foods,     │
│  recording dataset_version + embedding_model_version columns          │
└────────────────────────────────┬──────────────────────────────────────┘
                                  │ writes
┌─────────────────────────────────▼─────────────────────────────────────┐
│  Postgres (Supabase) — fdc_foods(fdc_id, description, embedding       │
│  vector(1536), kcal, protein_g, fat_g, carbs_g, sugar_g NULLABLE,     │
│  source, dataset_version, embedding_model_version)                    │
│  HNSW index: USING hnsw (embedding vector_cosine_ops)                 │
└─────────────────────────────────┬─────────────────────────────────────┘
                                  │ read-only queries (cosineDistance)
┌─────────────────────────────────▼─────────────────────────────────────┐
│  domain/fdc-matching/match-ingredient.ts                              │
│  (embedding: number[], repo: FdcRepository, topN=3) → candidates[]    │
│  — pure function, tested with a FAKE repo returning canned rows       │
└─────────────────────────────────────────────────────────────────────┘

(independent, no shared runtime state with the above)
┌─────────────────────────────────────────────────────────────────────┐
│  domain/nutrition/  — zero I/O, zero external deps                   │
│  bmr-tdee.ts: Mifflin-St Jeor + activity coefficient → TDEE          │
│  target-calories.ts: rate cap (±257 kcal/day) + safety floor         │
│  target-macros.ts: PROTEIN_G_PER_KG / FAT_G_PER_KG constants,        │
│    carbs = remainder (clamped at 0)                                  │
│  — tested with Vitest test.each across sex × goal × activity level   │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (Phase 1 slice)

```
src/
├── db/
│   ├── schema/
│   │   ├── users.ts          # onboarding profile fields
│   │   ├── diary.ts          # stub table only — Phase 4 fills this in
│   │   └── fdc-foods.ts      # vector(1536) column + HNSW index
│   └── client.ts             # drizzle(pg.Pool) — reads DATABASE_URL
│
├── domain/
│   ├── nutrition/
│   │   ├── bmr-tdee.ts
│   │   ├── target-calories.ts
│   │   ├── target-macros.ts
│   │   └── constants.ts      # PROTEIN_G_PER_KG=1.8, FAT_G_PER_KG=0.9,
│   │                          # CALORIE_FLOOR_FEMALE=1200, _MALE=1500,
│   │                          # MAX_RATE_KCAL_PER_DAY=257
│   └── fdc-matching/
│       ├── match-ingredient.ts
│       └── types.ts          # FdcRepository port, FdcCandidate type
│
├── adapters/
│   ├── embeddings/
│   │   └── openai-embed.ts   # embed(text) → number[], shared by indexer + (later) runtime
│   └── fdc-repository.ts     # Drizzle-backed FdcRepository implementation
│
├── scripts/
│   └── index-fdc/
│       ├── download.ts       # fetch + unzip Foundation Foods + SR Legacy
│       ├── parse-foundation.ts   # filter data_type='foundation_food'
│       ├── parse-sr-legacy.ts    # no filter needed
│       ├── resolve-nutrients.ts  # priority-ordered nutrient-ID lookup
│       ├── build-embeddings.ts
│       ├── load.ts           # idempotent upsert
│       └── run.ts            # entrypoint, `npm run index-fdc` target
│
└── config/
    └── env.ts                # dotenv-safe load + typed getters
```

### Pattern 1: Supabase connection string choice — Session Pooler as the default, not Direct or Transaction

**What:** Supabase exposes three connection endpoints for the same database:

| Type | Host pattern | Port | Prepared statements | Best for |
|------|--------------|------|---------------------|----------|
| Direct Connection | `db.<project-ref>.supabase.co` | 5432 | Yes | Persistent servers **with IPv6** (or the paid IPv4 add-on) |
| Session Pooler (Supavisor) | `aws-<region>.pooler.supabase.com` | 5432 | Yes | Persistent servers on a typical **IPv4-only** home/office network |
| Transaction Pooler (Supavisor) | `aws-<region>.pooler.supabase.com` | 6543 | **No** (`prepare: false` required) | Serverless/edge functions with many short-lived connections |

**When to use:** Default to **Session Pooler** (port 5432) as `DATABASE_URL` for both `drizzle-kit migrate` and the FDC indexing script. This works from essentially any developer machine (no IPv6 dependency) and, unlike Transaction Pooler, supports the prepared statements Drizzle's migration runner relies on. Only recommend Direct Connection if the owner confirms their network has IPv6 (most consumer ISPs in 2026 still don't guarantee it end-to-end).
**Why it matters:** Using the Transaction Pooler (6543) for `drizzle-kit migrate` is a documented failure mode — migrations can fail or behave unpredictably without `prepare: false`, and even with it, DDL-heavy migration tooling is not what transaction mode is designed for. **Confidence: HIGH** — verified directly from Supabase's own `connecting-to-postgres` and `drizzle` docs pages.

**Example `.env`:**
```
# Supabase → Project Settings → Database → Connection string → "Session pooler" tab
DATABASE_URL=postgres://postgres.<project-ref>:<db-password>@aws-<region>.pooler.supabase.com:5432/postgres
```

### Pattern 2: Filter Foundation Foods by `data_type`, not by file inclusion alone

**What:** `MATCH-02` says "no Branded Foods," and it is tempting to conclude that downloading only the Foundation Foods + SR Legacy zips (not the Branded Foods zip) is sufficient. **It is not, for Foundation Foods.** Verified by downloading and inspecting `FoodData_Central_foundation_food_csv_2026-04-30.zip`:

| `food.csv` `data_type` value | Row count | Indexable? |
|---|---|---|
| `foundation_food` | **469** | **Yes — these are the real, queryable foundation foods** |
| `market_acquisition` | 7,577 | No — retail purchase records (some literally brand-named, e.g. `"HUMMUS, SABRA CLASSIC"`) |
| `sample_food` | 4,079 | No — individual lab sample metadata |
| `sub_sample_food` | 75,055 | No — sub-sample-level lab data |
| `agricultural_acquisition` | 810 | No — raw agricultural acquisition metadata |

Total `food.csv` rows: 88,314. Only 469 (0.53%) are the actual indexable
Foundation Foods records. **SR Legacy needs no equivalent filter** — its
`food.csv` (7,793 rows) has exactly one `data_type` value,
`sr_legacy_food`, for every row.

**When to use:** Always, for the Foundation Foods source specifically. The SQL/parse-time filter is: `WHERE data_type = 'foundation_food'` on `food.csv` (equivalently, join against `foundation_food.csv`, which lists exactly those 469 `fdc_id`s).
**Why it's non-negotiable:** Indexing the unfiltered 88k rows would put brand-named retail products (e.g. "HUMMUS, SABRA CLASSIC") into `fdc_foods`, directly undermining MATCH-02's intent even though no Branded-Foods dataset was ever downloaded, and would 190x the embedding cost/index size for pure noise. **Confidence: HIGH — verified by direct inspection of the current dataset**, not documentation.

### Pattern 3: Priority-ordered nutrient-ID resolution, not a single hardcoded ID per macro

**What:** Verified coverage (computed by joining `food_nutrient.csv` against the filtered food-ID sets, current 2026-04-30/2018-04 datasets):

| Field | SR Legacy (7,793 foods) | Foundation Foods (469 foods) | Resolution strategy |
|---|---|---|---|
| Energy/calories | `1008` "Energy": **100%** | `1008`: 29% · `2047` "Energy (Atwater General)": 74% · `2048` "Energy (Atwater Specific)": 67% | Try `1008` → `2047` → `2048` → (last resort) compute `protein_g×4 + fat_g×9 + carbs_g×4` |
| Protein | `1003`: 100% | `1003`: 91% | `1003` only; if absent leave `null` |
| Fat | `1004`: 100% | `1004`: 88% | `1004` only; if absent leave `null` |
| Carbs | `1005`: 100% | `1005`: 80% | `1005` only; if absent leave `null` |
| Sugar | `2000` "Total Sugars": 77% · `1063` "Sugars, Total": **0%** | `2000`: **1.1%** · `1063`: 39% | Try `2000` → `1063`; if neither present, leave `null` (never `0`, per TECH_SPEC §5.8 / PITFALLS.md Pitfall 7) |

**When to use:** Always, in the `resolve-nutrients.ts` step of the indexing pipeline — build a small `NUTRIENT_ID_PRIORITY` map (field → ordered ID list) and apply it uniformly to both datasets rather than writing dataset-specific field-mapping code.
**Why it's non-negotiable:** A hardcoded single ID per field (e.g. "calories = nutrient 1008") silently produces `null`/missing calories for 71% of Foundation Foods records — a severe, silent data-completeness bug that would make most Foundation Foods entries unusable for the exact accuracy-first Core Value this project is built around. **Confidence: HIGH — verified by direct row-count inspection of the actual current dataset files**, cross-checked against USDA's own Foundation Foods Documentation PDF (which independently confirms `1008` was deprecated for Foundation Foods display in Oct 2020 in favor of `2047`/`2048`).

**Two more verified data-quality facts from direct inspection, both must be handled by the pipeline, not assumed away:**
- **Duplicate `(fdc_id, nutrient_id)` pairs exist** (a small number — 4 found in the Foundation Foods `food_nutrient.csv` for the 469 filtered records). The loader must pick a deterministic value (e.g., first-seen or max) rather than crash on a unique-constraint upsert or silently double-count.
- **33 rows in Foundation Foods `food_nutrient.csv` have an empty `amount` field** despite having a `nutrient_id` — must be treated as missing/`null`, not parsed as `0` or `NaN`.
- **42 of the 469 filtered Foundation Foods records (9%) have no protein, fat, or carbs values at all.** Recommend excluding these from the index entirely (log a count/list at indexing time) rather than inserting rows with entirely-null macros that would be useless (and confusing) as match candidates — this is a plan-level decision the executor should make explicitly, not by accident.

### Pattern 4: Drizzle + pgvector — exact schema and query syntax (verified against Drizzle's own guide)

**What:** Drizzle 0.36+ (project is on 0.45.2) has a native `vector()` pg-core column type and `cosineDistance()` query helper — no `customType()` needed.

**Enable the extension** (as a raw-SQL migration, since `CREATE EXTENSION` isn't a first-class Drizzle schema primitive):
```bash
npx drizzle-kit generate --custom --name=enable_pgvector
```
```sql
-- resulting migration file
CREATE EXTENSION IF NOT EXISTS vector;
```

**Schema** (`db/schema/fdc-foods.ts`):
```typescript
// Source: https://orm.drizzle.team/docs/guides/vector-similarity-search
import { index, pgTable, text, integer, real, vector, timestamp } from 'drizzle-orm/pg-core';

export const fdcFoods = pgTable(
  'fdc_foods',
  {
    fdcId: integer('fdc_id').primaryKey(),
    description: text('description').notNull(),
    source: text('source').notNull(),          // 'foundation_food' | 'sr_legacy_food'
    kcal: real('kcal'),
    proteinG: real('protein_g'),
    fatG: real('fat_g'),
    carbsG: real('carbs_g'),
    sugarG: real('sugar_g'),                   // nullable — "no data" per TECH_SPEC §5.8
    embedding: vector('embedding', { dimensions: 1536 }),
    datasetVersion: text('dataset_version').notNull(),
    embeddingModelVersion: text('embedding_model_version').notNull(),
    indexedAt: timestamp('indexed_at').defaultNow(),
  },
  (table) => [
    index('fdc_foods_embedding_hnsw')
      .using('hnsw', table.embedding.op('vector_cosine_ops')),
  ]
);
```
(1536 dimensions for `text-embedding-3-small` is well inside pgvector's
2,000-dimension HNSW limit — no truncation needed. **Confidence: HIGH**,
verified against current pgvector HNSW documentation.)

**Insert** (plain `number[]` works directly, no serialization helper needed):
```typescript
await db.insert(fdcFoods).values({
  fdcId: 323505,
  description: 'Kale, raw',
  source: 'foundation_food',
  kcal: 35, proteinG: 2.92, fatG: 1.49, carbsG: 4.42, sugarG: 0.8,
  embedding: embeddingArray, // number[], length 1536
  datasetVersion: '2026-04-30',
  embeddingModelVersion: 'text-embedding-3-small',
});
```

**Nearest-neighbor query** (top-3 candidates, cosine distance):
```typescript
// Source: https://orm.drizzle.team/docs/guides/vector-similarity-search
import { cosineDistance, desc, sql } from 'drizzle-orm';

const similarity = sql<number>`1 - (${cosineDistance(fdcFoods.embedding, queryEmbedding)})`;

const candidates = await db
  .select({ fdcId: fdcFoods.fdcId, description: fdcFoods.description, similarity })
  .from(fdcFoods)
  .orderBy((t) => desc(t.similarity))
  .limit(3);
```
**Confidence: HIGH** — this exact API (`vector()`, `.op('vector_cosine_ops')`, `cosineDistance()`) is verified from Drizzle's official vector-similarity-search guide, current as of this research.

### Pattern 5: Idempotent upsert with recorded versions (already required by D-03)

**What:** `load.ts` must use `ON CONFLICT (fdc_id) DO UPDATE` (Drizzle: `.onConflictDoUpdate()`), and every row must record `dataset_version` (the FDC release date string, e.g. `"2026-04-30"` for Foundation Foods, `"2018-04"` for SR Legacy) and `embedding_model_version` (e.g. `"text-embedding-3-small"`). This lets a re-run detect "the dataset changed" or "the embedding model changed" instead of silently mixing embeddings from two different models in the same HNSW index (a correctness bug the ARCHITECTURE.md research already flags as Anti-Pattern 3's underlying risk).
**When to use:** From the first version of the indexing script — retrofitting idempotency after a script "mostly works" is more expensive than building it in from the start, and D-03 explicitly requires safe re-runnability.

### Anti-Patterns to Avoid

- **Indexing all of Foundation Foods' `food.csv` rows:** See Pattern 2 — 99.5% of rows are non-indexable supporting data, some brand-labeled.
- **Hardcoding nutrient ID `1008` as "the" calories field:** Covers only 29% of Foundation Foods records. See Pattern 3.
- **Using nutrient ID `2000` for sugar universally:** Correct for SR Legacy (77%) but nearly absent in Foundation Foods (1.1%, use `1063` there instead — 39%).
- **`COALESCE(sugar, 0)` or any missing-nutrient-to-zero coalescing:** Already flagged in PITFALLS.md Pitfall 7 — reinforced here because the verified data shows a majority of Foundation Foods records (61%) have no populated sugar field via either candidate ID, so this bug would silently corrupt most Foundation Foods sugar totals, not an edge case.
- **`drizzle-kit push` as the documented migration workflow:** No history, no review step, can silently drop columns — use `generate` + `migrate`.
- **Transaction Pooler (port 6543) for `drizzle-kit migrate` or the indexing script:** Documented to not support prepared statements without `prepare: false`, and is designed for ephemeral serverless connections, not a long-running local script or the migration tool.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cosine-distance nearest-neighbor search | A JS loop computing dot products across all rows in memory | pgvector's `<=>` operator + HNSW index via Drizzle's `cosineDistance()` | pgvector is a C extension purpose-built for this; a JS loop is both slower and throws away the index entirely |
| Embedding array → Postgres `vector` serialization | Manual `'[0.1,0.2,...]'` string building | Drizzle's native `vector()` column type (accepts plain `number[]` on insert/query) | Verified in Drizzle 0.45.2 — no serialization helper needed at all |
| CSV parsing of multi-hundred-thousand-row FDC files | A hand-rolled `split(',')` line parser | `csv-parse` in streaming mode | FDC CSV fields are quoted and can contain commas/newlines inside quotes (e.g. long food descriptions) — a naive split will misparse these |
| Env var validation | Manual `if (!process.env.X) throw` scattered through the codebase | `dotenv-safe` (fails fast against a `.env.example` template) | Centralizes the "did I forget to set a required var" failure into one obvious point at startup |
| Missing-nutrient-field semantics | Treating a missing FDC nutrient row as `0` | Explicit nullable columns + priority-ordered ID resolution (Pattern 3) that leaves `null` when nothing matches | `0` is a real, meaningfully different value from "we don't know" — conflating them is Pitfall 7 |

**Key insight:** The two things that look like "just use the library" defaults
(pgvector index, Drizzle column type) genuinely are — Drizzle's pgvector
support is mature and needs no workaround. The real hand-rolling risk in this
phase is entirely in the **data-mapping layer** (which nutrient ID means
what, which rows are real), which no library can verify for you — it had to
be checked against the actual current dataset, which is what this research
did.

## Common Pitfalls

### Pitfall 1: Indexing Foundation Foods' non-`foundation_food` rows (verified, see Pattern 2)
**What goes wrong:** `fdc_foods` ends up ~190x larger than intended, polluted with brand-named retail-purchase records and duplicate lab-sample rows for the same underlying food.
**Why it happens:** `food.csv`'s column layout doesn't visually scream "filter me" — every row looks like a normal food row until you check `data_type`.
**How to avoid:** Explicit `WHERE data_type = 'foundation_food'` filter (or join against `foundation_food.csv`'s 469 `fdc_id`s), verified via a row-count assertion in the indexing script's log output (e.g., "Filtered 88,314 → 469 Foundation Foods rows").
**Warning signs:** `fdc_foods` row count is in the tens of thousands instead of ~8,200 (469 + 7,793); candidate matches during MATCH-01 testing surface all-caps brand names.

### Pitfall 2: Single hardcoded nutrient ID per macro field (verified, see Pattern 3)
**What goes wrong:** Most Foundation Foods records end up with `null` calories/sugar even though the data exists under a different nutrient ID.
**Why it happens:** SR Legacy and Foundation Foods were built by different processes years apart and use different "which ID is populated" conventions for the same logical field.
**How to avoid:** Priority-ordered ID lookup list per field, applied uniformly; log per-field coverage stats after indexing so a coverage regression is visible immediately.
**Warning signs:** A large fraction of indexed Foundation Foods rows show `null` calories in a spot-check query.

### Pitfall 3: Coalescing missing sugar (and other nutrients) to `0`
Already documented in PITFALLS.md Pitfall 7 — reinforced by this research's finding that the majority of Foundation Foods records (61%) have no sugar value under either candidate nutrient ID, making this not a rare edge case but the common case for that dataset.
**Phase to address:** This phase (indexing pipeline schema/mapping), not deferred to the diary/calculation phase — retrofitting nullable semantics after `fdc_foods.sugar_g` is already a non-null column with zeros in it is expensive.

### Pitfall 4: Wrong Supabase connection type for migrations (verified, see Pattern 1)
**What goes wrong:** `drizzle-kit migrate` run against the Transaction Pooler (port 6543) without `prepare: false`, or against Direct Connection from a network without IPv6, fails or hangs in a way that's confusing for a first-time backend developer to diagnose.
**How to avoid:** Default to Session Pooler (port 5432) for both the indexing script and `drizzle-kit` commands; document the exact `.env` value to copy from Supabase's dashboard "Session pooler" tab, not the default-shown tab (which may be Direct Connection or Transaction Pooler depending on Supabase's current UI default).
**Warning signs:** Migration commands hang or throw connection-refused/timeout errors; `getaddrinfo ENOTFOUND` if the wrong hostname format is pasted.

### Pitfall 5: Raw vs. cooked FDC entries mismatched (carried forward from PITFALLS.md Pitfall 4)
Still fully applicable to this phase's MATCH-01 success criterion ("3 plausible candidates for 10 hand-picked ingredient names") — the FDC description text (which usually states raw/cooked/method) should be surfaced verbatim in candidate output so this is at least visible, even though full state-aware filtering is more naturally a Phase 3/4 concern once the LLM's `state` tagging exists. Include at least 2-3 raw/cooked-ambiguous ingredients (chicken, beef, rice) in the phase's 10 hand-picked matching test names specifically to surface this early.

### Pitfall 6: Near-duplicate top-3 candidates (carried forward from PITFALLS.md Pitfall 5)
A naive `ORDER BY embedding <=> $1 LIMIT 3` can return three near-identical rows. For Phase 1's success criterion ("3 plausible candidates... for at least 10 hand-picked ingredient names"), a manual spot-check of diversity is sufficient — do not over-build MMR/diversity re-ranking in this phase (it's explicitly a Phase 3/4-adjacent UX concern per PITFALLS.md's own phase mapping), but do log/notice if the 10-name manual check shows suspiciously identical candidates, since that's a signal worth carrying into later phases.

### Pitfall 7: OpenAI spend limit is enforced, but not instantaneous
**What goes wrong:** Owner sets a hard spend limit expecting it to behave like a hard wall; a burst of near-simultaneous requests (e.g., a bug retrying rapidly during indexing-script development) can still leak a small amount of spend past the configured cap before enforcement catches up.
**Why it happens:** OpenAI's own documentation for the (July-2026-restored) hard spend limit feature explicitly states enforcement is not instantaneous.
**How to avoid:** Layer a lower "alert" threshold notification below the hard cap (both are independently configurable), and additionally keep the FDC embedding batch size sane (~100 per call, per STACK.md) so a runaway loop can't fire thousands of calls before anyone notices.
**Confidence: HIGH** — directly verified against OpenAI's current spend-limits documentation.

## Code Examples

### FDC nutrient priority resolution (TypeScript)

```typescript
// Source: verified coverage analysis of FoodData_Central_foundation_food_csv_2026-04-30
// and FoodData_Central_sr_legacy_food_csv_2018-04 (this research session)
export const NUTRIENT_ID_PRIORITY = {
  kcal: [1008, 2047, 2048],     // legacy Energy, Atwater General, Atwater Specific
  proteinG: [1003],
  fatG: [1004],
  carbsG: [1005],
  sugarG: [2000, 1063],         // "Total Sugars" (SR Legacy), "Sugars, Total" (Foundation Foods)
} as const;

function resolveNutrient(
  nutrientsByFoodId: Map<number, string>, // nutrient_id (as string) -> amount (as string)
  priorityIds: readonly number[],
): number | null {
  for (const id of priorityIds) {
    const raw = nutrientsByFoodId.get(id);
    if (raw !== undefined && raw !== '') {
      const value = Number(raw);
      if (!Number.isNaN(value)) return value;
    }
  }
  return null; // never default to 0 — "no data" per TECH_SPEC §5.8
}
```

### CSV streaming parse (Node/csv-parse)

```typescript
// Source: https://csv.js.org/parse/api/ (Stream API)
import fs from 'node:fs';
import { parse } from 'csv-parse';

const stream = fs
  .createReadStream('food.csv') // 2026-04-30 bundle verified valid UTF-8;
                                  // USDA docs historically specify ISO-8859-1 —
                                  // wrap in a try/catch re-read with { encoding: 'latin1' }
                                  // as a defensive fallback for older/future releases.
  .pipe(parse({ columns: true }));

for await (const record of stream) {
  if (record.data_type === 'foundation_food') {
    // record.fdc_id, record.description, ...
  }
}
```

### BMR/TDEE/target-macro domain functions (edge cases made explicit)

```typescript
// domain/nutrition/constants.ts
export const PROTEIN_G_PER_KG = 1.8; // D-04 default — adjustable, not a medical claim
export const FAT_G_PER_KG = 0.9;     // D-04 default
export const CALORIE_FLOOR_FEMALE = 1200; // TECH_SPEC §6.3 reference floor
export const CALORIE_FLOOR_MALE = 1500;   // TECH_SPEC §6.3 reference floor
export const MAX_RATE_KCAL_PER_DAY = Math.round(7700 / 30); // ≈257, TECH_SPEC §6.3

// domain/nutrition/bmr-tdee.ts
// Source: TECH_SPEC.md §6.1-6.2, cross-verified against Mifflin-St Jeor's
// original published formula (verified via WebSearch, multiple concordant sources)
export function calculateBmr(sex: 'male' | 'female', weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

// domain/nutrition/target-calories.ts — edge cases:
// 1. Floor collision: TDEE - 257 may fall below the sex-specific floor for a
//    small/older/female user — floor must be applied AFTER the rate-cap
//    adjustment, not instead of it (floor wins, i.e. target = max(TDEE - 257, floor)).
// 2. Maintenance/biohacking goal: target = TDEE exactly, floor is irrelevant
//    (TDEE for a living adult is essentially always above the floor).
// 3. Gain goal: no floor concern (TDEE + 257 only ever increases), but should
//    still be tested for absurdly low TDEE inputs (e.g. malformed onboarding data).
export function calculateTargetCalories(
  sex: 'male' | 'female',
  tdee: number,
  goal: 'gain' | 'loss' | 'maintain',
): number {
  if (goal === 'maintain') return Math.round(tdee);
  const floor = sex === 'male' ? CALORIE_FLOOR_MALE : CALORIE_FLOOR_FEMALE;
  const raw = goal === 'gain' ? tdee + MAX_RATE_KCAL_PER_DAY : tdee - MAX_RATE_KCAL_PER_DAY;
  return Math.round(goal === 'loss' ? Math.max(raw, floor) : raw);
}

// domain/nutrition/target-macros.ts — edge case: carbs can go negative for a
// very light person hitting the calorie floor with high protein/fat presets
// (e.g. 40kg female at the 1200kcal floor: protein 72g=288kcal, fat 36g=324kcal,
// leaving 588kcal/~147g carbs — fine here, but must be clamped at 0 defensively
// for pathological inputs rather than ever surfacing a negative gram value).
export function calculateTargetMacros(weightKg: number, targetCalories: number) {
  const proteinG = weightKg * PROTEIN_G_PER_KG;
  const fatG = weightKg * FAT_G_PER_KG;
  const remainingKcal = targetCalories - (proteinG * 4 + fatG * 9);
  const carbsG = Math.max(0, remainingKcal / 4); // clamp — see edge case above
  return { proteinG: Math.round(proteinG), fatG: Math.round(fatG), carbsG: Math.round(carbsG) };
}
```

### Vitest table-driven test pattern

```typescript
// Source: https://oliviac.dev/blog/introduction-to-table-driven-tests-in-vitest/
// and https://vitest.dev (test.each API, verified against installed vitest@4.1.10)
import { describe, expect, test } from 'vitest';
import { calculateBmr } from '../src/domain/nutrition/bmr-tdee';

const cases = [
  { sex: 'male' as const, weightKg: 80, heightCm: 180, age: 30, expected: 1780 },
  { sex: 'female' as const, weightKg: 60, heightCm: 165, age: 30, expected: 1320.75 },
  // ...cover every sex × goal × activity-level combination the roadmap requires
];

describe('calculateBmr', () => {
  test.each(cases)(
    '$sex, ${weightKg}kg, ${heightCm}cm, ${age}y => $expected kcal',
    ({ sex, weightKg, heightCm, age, expected }) => {
      expect(calculateBmr(sex, weightKg, heightCm, age)).toBeCloseTo(expected, 2);
    },
  );
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| OpenAI monthly budget as a hard cutoff | Budget as notification-only, requests keep flowing past it | Earlier in 2026 | A "set a budget" instruction alone no longer protects against overspend |
| (regression fix) Notification-only budget | **Hard spend limit restored** at org/project level — further requests fail with `429 insufficient_quota` once the cap is hit | Week of 2026-07-22 | The owner's spend-cap requirement (CONTEXT.md D-02) is now concretely satisfiable again — verify this is still true at execution time, since it's a recent reversal |
| USDA FDC "Energy" field (nutrient ID 1008) for all data types | Foundation Foods computes energy via Atwater General/Specific factors (IDs 2047/2048), 1008 kept only for legacy API compatibility and sparsely populated | October 2020 (per USDA's own Foundation Foods Documentation) | Directly drives Pattern 3's priority-ordered ID resolution requirement |
| Drizzle `customType()` workarounds for pgvector | Native `vector()` pg-core column type + `cosineDistance()`/`l2Distance()` helpers | Drizzle 0.36+ (project is on 0.45.2) | No custom type code needed — use the built-in API directly |

**Deprecated/outdated:**
- Nutrient ID `1008` ("Energy") as the sole calories source for Foundation Foods — deprecated for display in Oct 2020 per USDA's own documentation, and verified here to cover only 29% of current Foundation Foods records.
- `drizzle-orm`'s pre-0.36 vector workarounds (raw `sql` template hacks, third-party custom types) — unnecessary on the currently-installed 0.45.2.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Owner's home/office network is IPv4-only (recommending Session Pooler as the default connection type over Direct Connection) | Pattern 1 | Low — if the owner does have IPv6, Direct Connection also works fine and is Supabase's own preference for persistent servers; this is a "safe default," not a hard requirement, and the plan should mention both |
| A2 | Excluding the 42 Foundation Foods records with zero macro data entirely (rather than indexing them with all-null nutrients) is the right call | Pattern 3 | Low-Medium — a reasonable alternative is to index them anyway with visible nulls; either is defensible, but the plan must make an explicit, documented choice rather than defaulting silently either way |
| A3 | Duplicate `(fdc_id, nutrient_id)` rows should resolve via "first-seen wins" (or max) rather than being investigated further for a root cause | Pattern 3 | Low — only 4 rows found in the entire filtered Foundation Foods set; any deterministic tie-break is acceptable at this scale, but the loader should log when it happens |
| A4 | OpenAI's hard spend limit UI navigation (exact menu labels: "Limits" tab, "Edit spend limit," "Enforce a hard limit" toggle) matches what the owner will see at execution time | Pattern re: OpenAI setup / Common Pitfalls | Medium — dashboard UI copy/layout can drift between this research date and execution; the underlying capability (hard limit, 429 on breach) is verified from official docs, but exact click-path should be re-confirmed by the executor with a screenshot-level check during setup |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Should the 42 macro-less Foundation Foods records be indexed at all?**
   - What we know: 9% of the 469 filtered Foundation Foods records have no protein/fat/carb data under any resolvable nutrient ID.
   - What's unclear: Whether some of these are still useful as name-only semantic-search anchors (e.g., a spice or flavoring with genuinely negligible/unmeasured macros) versus genuinely broken/incomplete entries.
   - Recommendation: Default to excluding them from `fdc_foods` and logging the excluded `fdc_id`/description list at indexing time, so the executor/owner can review the list once and override per-item later if needed — cheap to change since re-indexing takes minutes.

2. **Exact text composed for the embedding input** — TECH_SPEC §5.5 says "build embedding by name (+ description)," but Foundation Foods' `description` field is already the full name/description (there's no separate short-name field distinct from description in the CSV structure verified here).
   - What we know: `food.csv`'s `description` column is the only name-bearing field for both datasets (e.g., `"Kale, raw"`, `"Broccoli, raw"`).
   - What's unclear: Whether to prepend the food category (`food_category.csv`, e.g. "Vegetables and Vegetable Products") to the embedding text for extra semantic context, or embed the bare description only.
   - Recommendation: Start with the bare `description` string (simplest, matches TECH_SPEC's literal wording); this is cheap to change and re-index later if MATCH-01's 10-name manual check shows category confusion.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime for indexing script, Vitest, Drizzle | ✓ | v22.22.1 | — (matches STACK.md's recommended Node 22 LTS) |
| npm | Package management | ✓ | 10.9.4 | — |
| `curl`/network access | Downloading USDA FDC zip bundles | ✓ (verified — this research session successfully downloaded both bundles) | — | — |
| Supabase account/project | Postgres hosting (D-01) | Not yet provisioned — owner has no existing project | — | Plan must include full account+project creation steps (no fallback needed, this is Wave 0 setup work) |
| OpenAI account/API key | Embedding generation (D-02) | Not yet provisioned — owner has zero API accounts | — | Plan must include full account+key+spend-limit setup steps |
| Docker | Not required for this phase | N/A | — | D-01 explicitly avoids local Docker/Postgres — no Docker dependency in this phase's plan |

**Missing dependencies with no fallback:** Supabase project and OpenAI API
key must be created as part of this phase's execution (Wave 0-equivalent
setup work) — both have zero-cost tiers sufficient for this phase's scale
(10-13k FDC records, one-time embedding batch).

**Missing dependencies with fallback:** None applicable — no dependency in
this phase has a viable substitute if the primary is unavailable (there is no
Postgres-without-pgvector fallback for MATCH-01, no free-tier-less path for
OpenAI embeddings given D-02's explicit provider choice).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (verified via `npm view`) |
| Config file | none yet — Wave 0 gap, needs `vitest.config.ts` + `package.json` `"test"` script |
| Quick run command | `npx vitest run domain/nutrition` (or `--dir` scoped to the domain layer) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ONBOARD-03 | BMR + TDEE + rate cap + safety floor, across each sex × goal | unit | `npx vitest run domain/nutrition/bmr-tdee.test.ts domain/nutrition/target-calories.test.ts` | ❌ Wave 0 |
| ONBOARD-04 | Target macro grams from target calories + presets, incl. carbs-clamp edge case | unit | `npx vitest run domain/nutrition/target-macros.test.ts` | ❌ Wave 0 |
| MATCH-01 | `matchIngredient()` returns top-N candidates via a repository port | unit (fake repo) | `npx vitest run domain/fdc-matching/match-ingredient.test.ts` | ❌ Wave 0 |
| MATCH-01 (integration) | Real pgvector query against the indexed dev DB returns 3 plausible candidates for 10 hand-picked names | scripted integration (matches the phase's own success criterion #4 wording — "manual or scripted query") | `npx tsx scripts/index-fdc/verify-matches.ts` (new script, checks 10 hardcoded names, asserts `source != 'branded_food'` for every candidate) | ❌ Wave 0 |
| MATCH-02 | Indexing pipeline never writes Branded Foods / never writes non-`foundation_food` supporting rows | unit (filter logic) + integration (row-count assertion in `run.ts` output) | `npx vitest run scripts/index-fdc/parse-foundation.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** targeted `vitest run` on the file(s) touched.
- **Per wave merge:** `npx vitest run` (full domain-layer suite; the FDC indexing pipeline itself is better verified by its own logged output + the `verify-matches.ts` script than by mocking Postgres in Vitest).
- **Phase gate:** Full suite green + `verify-matches.ts` shows 3 plausible, non-Branded candidates for all 10 hand-picked names before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.ts` + `package.json` `"test"` script — no test framework configured yet (greenfield project, no `package.json` exists yet either)
- [ ] `domain/nutrition/*.test.ts` — BMR/TDEE/target-calorie/target-macro table-driven tests
- [ ] `domain/fdc-matching/match-ingredient.test.ts` — fake-repository unit test for ranking/candidate-count behavior
- [ ] `scripts/index-fdc/parse-foundation.test.ts` — unit test asserting the `data_type='foundation_food'` filter against a small fixture CSV snippet (a handful of rows copied from the real file, including at least one `market_acquisition` row, to assert it's excluded)
- [ ] `scripts/index-fdc/verify-matches.ts` — the scripted integration check the phase's own success criterion #4 calls for (10 hand-picked English ingredient names, asserts 3 candidates each, asserts no Branded Foods source)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This phase has no user-facing auth surface (no Telegram/web endpoints yet) |
| V3 Session Management | No | Same as above |
| V4 Access Control | No | Same as above — `fdc_foods` is a reference table with no per-user access boundary |
| V5 Input Validation | Yes | CSV-derived values must be validated/coerced (numeric parse with `NaN` guard, per Pattern 3's `resolveNutrient`); env vars validated via `dotenv-safe` fail-fast |
| V6 Cryptography | Partial | No custom crypto in this phase; TLS to Supabase/OpenAI is handled by the respective client libraries (`pg`/`postgres` + Supabase pooler enforce TLS by default; `openai` SDK uses HTTPS) — do not disable/override TLS verification for convenience |

### Known Threat Patterns for this phase's stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| SQL injection via CSV-derived food descriptions inserted into Postgres | Tampering | Drizzle's query builder parameterizes all values automatically — never string-concatenate raw SQL with CSV field values, even though FDC data is a "trusted" source (defense in depth against a corrupted/malicious future data source) |
| Secrets committed to git (`DATABASE_URL` with embedded password, `OPENAI_API_KEY`) | Information Disclosure | `.gitignore` covers `.env*` from the first commit; `.env.example` with placeholder values only, tracked in git; already flagged project-wide in CLAUDE.md and PITFALLS.md Pitfall 12 — this phase is where the first real secrets (Supabase DB password, OpenAI key) enter the project, so it's the concrete point this must be enforced, not a future phase |
| Uncapped OpenAI embedding spend during indexing-script development (retry loops, accidental full-dataset re-runs) | Denial of Service (of the owner's budget, not the system) | Hard spend limit (Pattern re: OpenAI, verified current-as-of-2026-07-22) + batch size discipline (~100 texts/call) + idempotent upsert (Pattern 5) so re-runs don't re-embed already-indexed rows unnecessarily |

## Sources

### Primary (HIGH confidence)
- **Direct file inspection** of `FoodData_Central_foundation_food_csv_2026-04-30.zip` and `FoodData_Central_sr_legacy_food_csv_2018-04.zip`, downloaded live from `fdc.nal.usda.gov` during this research session — `food.csv`, `food_nutrient.csv`, `nutrient.csv`, `foundation_food.csv`, `food_category.csv` row counts, `data_type` distribution, and per-nutrient-ID coverage percentages computed directly, not inferred.
- USDA Foundation Foods Documentation PDF (`fdc.nal.usda.gov/docs/Foundation_Foods_Documentation_Apr2024.pdf`) — confirms nutrient ID 1008 deprecation for Foundation Foods display (Oct 2020) in favor of 2047/2048, and confirms all nutrient values are per-100g edible-portion basis.
- `https://fdc.nal.usda.gov/download-datasets` / `download-datasets.html` — live-fetched current download links (verified exact zip filenames and dates: `FoodData_Central_foundation_food_csv_2026-04-30.zip`, `FoodData_Central_sr_legacy_food_csv_2018-04.zip`).
- `https://orm.drizzle.team/docs/guides/vector-similarity-search` — exact `vector()` column, HNSW index, `cosineDistance()` API (Drizzle 0.36+, matches installed 0.45.2).
- `https://supabase.com/docs/guides/database/connecting-to-postgres` and `https://supabase.com/docs/guides/database/drizzle` — Direct/Session/Transaction connection formats and Drizzle+Supabase setup.
- `https://developers.openai.com/api/docs/guides/spend-limits` — current (2026-07-22+) hard spend limit behavior, dashboard navigation, `429 insufficient_quota` error codes.
- `npm view` live registry queries (2026-08-10) for `drizzle-orm`, `drizzle-kit`, `pg`, `openai`, `vitest`, `csv-parse`.
- `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md` — project-level research this phase builds on (not re-derived).
- `TECH_SPEC.md` §5.4-5.8, §6 — canonical formulas and constraints (Mifflin-St Jeor, TDEE table, rate cap, sugar-null requirement).

### Secondary (MEDIUM confidence)
- `https://csv.js.org/parse/api/` — `csv-parse` streaming API pattern.
- WebSearch-aggregated Mifflin-St Jeor accuracy figures (82% within 10% of measured RMR) — cross-referenced across multiple nutrition-reference sources, consistent with TECH_SPEC's own formula.
- `https://blog.alephant.io/openai-spend-limit-how-to-cap-your-api-bill-2026/` and `https://ai-tldr.dev/releases/openai-hard-spend-limits/` — corroborate the OpenAI spend-limit policy timeline (notification-only period, then hard-limit restoration July 2026); exact dashboard click-path wording should be re-confirmed at execution time (see Assumption A4).

### Tertiary (LOW confidence)
- None used for load-bearing claims in this document — every claim above either has a primary verification or is explicitly logged in the Assumptions table.

## Metadata

**Confidence breakdown:**
- Standard stack (Drizzle/pg/csv-parse/vitest versions): HIGH — live `npm view` queries.
- FDC data structure and nutrient-ID mapping: HIGH — verified by downloading and directly inspecting the actual current dataset files, the single most rigorous verification method available for this claim type.
- Supabase connection-type guidance: HIGH for the technical behavior (pooler modes, prepared-statement support), MEDIUM for exact current dashboard UI labels (Assumption A4-adjacent).
- OpenAI spend-limit setup: HIGH for current capability (verified against official OpenAI docs), MEDIUM for exact dashboard click-path wording.
- Domain math (Mifflin-St Jeor/TDEE/macros): HIGH — TECH_SPEC is the primary source (project's own locked spec) and independently cross-verified against external nutrition references.

**Research date:** 2026-08-10
**Valid until:** ~30 days for the Drizzle/Supabase/OpenAI setup guidance (stable, slow-moving APIs, though OpenAI's spend-limit policy has already changed twice in 2026 — re-verify if execution happens more than a few weeks out); the USDA FDC file-structure findings are valid until the next Foundation Foods refresh (FDC's own schedule is April/December — next refresh expected ~December 2026, well past this phase's execution window).
