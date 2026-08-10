# Phase 1: Foundation — data + domain math - Context

**Gathered:** 2026-08-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Postgres schema, an offline USDA FDC indexing pipeline (Foundation Foods +
SR Legacy → embeddings → DB), and a pure, fully unit-testable domain layer
(BMR/TDEE/target-macro calculation, FDC embedding matching) — with zero
Telegram code and zero bot dependency. Covers requirements ONBOARD-03,
ONBOARD-04, MATCH-01, MATCH-02.

</domain>

<decisions>
## Implementation Decisions

### Hosting & environment
- **D-01:** Postgres is hosted on a managed cloud provider (Supabase),
  not local Docker — owner has no backend infra experience, wants to avoid
  local Postgres/extension setup and prefers seeing data in a web UI.
  Planner/executor must produce step-by-step Supabase project setup
  instructions (create project, enable `pgvector`, get connection string,
  where to put it in `.env`) as part of this phase's deliverables.

### API providers
- **D-02:** Owner has no existing API accounts for STT/LLM/embeddings —
  starting from zero. Use OpenAI for the embedding provider in this phase
  (`text-embedding-3-small`, per research/STACK.md) since it's the cheapest
  and simplest to set up, and this account will likely be reused for LLM
  dish-decomposition in Phase 3. The plan must include detailed instructions
  for creating an OpenAI account, generating an API key, and adding billing
  (with an explicit spend-limit/budget-cap recommendation, since owner has
  no experience monitoring API costs).

### FDC indexing pipeline
- **D-03:** The one-time USDA FDC indexing pipeline is invoked as a simple
  terminal command (e.g. `npm run index-fdc`), not a UI or automated CI job.
  Owner will run it manually once (and again only if the FDC dataset is
  refreshed). The plan must document exactly what to type, what successful
  output looks like, and what to do if it fails partway (safe to re-run /
  idempotent, per PITFALLS.md).

### KБЖУ macro preset ratios
- **D-04:** Exact protein/fat gram-per-kg ratios for the target-macro
  calculation (TECH_SPEC.md §6.4 gives ranges: protein 1.6–2.0 g/kg, fat
  0.8–1.0 g/kg) are Claude's discretion. Use reasonable defaults — protein
  1.8 g/kg body weight, fat 0.9 g/kg body weight, carbs = remainder of
  target calories — and document the chosen constants clearly in code
  (comment or named constants) so they're easy to find and adjust later.
  Not a locked nutritional claim — a documented, changeable default.

### Claude's Discretion
- Exact Postgres schema field names/types, migration tool choice (per
  research/STACK.md: Drizzle ORM), and internal module structure for the
  domain layer (nutrition math, FDC matching) — no specific owner preference
  expressed, follow research/ARCHITECTURE.md's hexagonal boundary guidance
  (domain layer has zero Telegram/DB-driver imports).
- Exact BMR/TDEE/macro-preset constants beyond the protein/fat ratios above
  (e.g. calorie safety floor exact values — TECH_SPEC.md §6.3 already
  specifies ~1200/1500 kcal as reference floors).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & scope
- `TECH_SPEC.md` — full technical spec; §6 (target КБЖУ calculation
  formulas), §5.4-5.5 (FDC matching/indexing), §5.8 (missing-sugar handling)
  are directly relevant to this phase
- `.planning/PROJECT.md` — project context, Core Value, Key Decisions
- `.planning/REQUIREMENTS.md` — ONBOARD-03, ONBOARD-04, MATCH-01, MATCH-02
  (this phase's requirement IDs)

### Research (produced during /gsd-new-project)
- `.planning/research/STACK.md` — recommended stack incl. Postgres 17 +
  pgvector, Drizzle ORM, `text-embedding-3-small`, FDC bulk-download
  acquisition method (§6 "USDA FoodData Central: acquisition method")
- `.planning/research/ARCHITECTURE.md` — hexagonal component boundaries,
  offline FDC indexer as separate CLI entrypoint, build order
- `.planning/research/PITFALLS.md` — raw-vs-cooked FDC mismatch risk,
  unvalidated data pitfalls relevant to indexing quality
- `.planning/research/SUMMARY.md` — reconciled recommendations (in-process
  async decision doesn't apply to this phase, but Phase 1 build-order
  rationale does)

### Project rules
- `CLAUDE.md` — owner has no backend experience; setup instructions must be
  detailed/step-by-step; don't blindly agree with implementation shortcuts
  that would hurt the project's accuracy-first Core Value

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
None — this is the first phase of a new project, no existing code.

### Established Patterns
None yet. This phase establishes the initial patterns (hexagonal domain
layer, Drizzle schema conventions) that later phases will follow.

### Integration Points
None yet — Phase 2 (bot skeleton + onboarding) will be the first consumer
of this phase's domain layer (target-calc functions) and Phase 3 will be
the first consumer of the FDC matching function.

</code_context>

<specifics>
## Specific Ideas

No specific implementation ideas beyond the decisions captured above — owner
deferred exact nutrition-math constants and internal code structure to
Claude's discretion.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Foundation — data + domain math*
*Context gathered: 2026-08-10*
