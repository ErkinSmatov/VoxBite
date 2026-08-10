---
phase: 1
slug: foundation-data-domain-math
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 |
| **Config file** | none yet — Wave 0 installs `vitest.config.ts` + `package.json` `"test"` script |
| **Quick run command** | `npx vitest run domain/nutrition` (scoped to touched area) |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5-10 seconds (pure-function unit tests, no network/DB in the suite itself) |

---

## Sampling Rate

- **After every task commit:** Run targeted `npx vitest run <touched file>`
- **After every plan wave:** Run `npx vitest run` (full domain-layer suite)
- **Before `/gsd-verify-work`:** Full suite green + `npx tsx scripts/index-fdc/verify-matches.ts` shows 3 plausible, non-Branded-Foods candidates for all 10 hand-picked ingredient names
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01 | 01 | 1 | — | — | Vitest configured and runnable; secrets never committed | infra | `npx vitest --version && npx vitest run` | ❌ W0 | ⬜ pending |
| 01-02 | 02 | 2 | ONBOARD-03, MATCH-01, MATCH-02 | — | Supabase + OpenAI reachable, spend capped | manual (owner) | `npm run check-setup` | ❌ W0 | ⬜ pending |
| 01-03 | 03 | 3 | ONBOARD-03, MATCH-01, MATCH-02 | — | Schema + RLS + `[BLOCKING]` `drizzle-kit generate`+`migrate` against real Supabase DB | integration | `npx drizzle-kit generate && npx drizzle-kit migrate` + `verify-schema` | ❌ W0 | ⬜ pending |
| 01-04 | 04 | 2 | ONBOARD-03, ONBOARD-04 | — | BMR + TDEE + rate cap + safety floor + fat-share floor correct across sex × goal | unit (TDD) | `npx vitest run domain/nutrition/bmr-tdee.test.ts domain/nutrition/target-calories.test.ts domain/nutrition/target-macros.test.ts` | ❌ W0 | ⬜ pending |
| 01-05 | 05 | 2 | MATCH-02 | T-01-02 | `data_type='foundation_food'` filter + priority-ordered nutrient-ID resolution, null never coerced to 0 | unit | `npx vitest run scripts/index-fdc/parse-foundation.test.ts` | ❌ W0 | ⬜ pending |
| 01-06 | 06 | 4 | MATCH-01, MATCH-02 | T-01-01, T-01-02 | Embedding adapter + idempotent loader + runtime tripwire (abort if kept Foundation rows > 5000) | unit + integration | `npx vitest run` (loader tests) | ❌ W0 | ⬜ pending |
| 01-07 | 07 | 5 | MATCH-02 | T-01-02 | Full index run against real Supabase DB; `verify-index` integrity check | scripted integration | `npm run index-fdc` + `npx tsx scripts/index-fdc/verify-index.ts` | ❌ W0 | ⬜ pending |
| 01-08 | 08 | 6 | MATCH-01, MATCH-02 | T-01-01 | `matchIngredient()` (fake-repo unit) + real pgvector cosine query + owner plausibility checkpoint | unit + scripted integration + manual (owner) | `npx vitest run domain/fdc-matching/match-ingredient.test.ts` + `npx tsx scripts/index-fdc/verify-matches.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Updated 2026-08-11 after gsd-planner wrote all 8 PLAN.md files and gsd-plan-checker verified them (VERIFICATION PASSED, 0 blockers).*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` + `package.json` `"test"` script — no test framework configured yet (greenfield project)
- [ ] `domain/nutrition/*.test.ts` — BMR/TDEE/target-calorie/target-macro table-driven tests (stubs)
- [ ] `domain/fdc-matching/match-ingredient.test.ts` — fake-repository unit test stub for ranking/candidate-count behavior
- [ ] `scripts/index-fdc/parse-foundation.test.ts` — unit test asserting the `data_type='foundation_food'` filter against a small fixture CSV snippet (must include at least one `market_acquisition`-type row to assert exclusion)
- [ ] `scripts/index-fdc/verify-matches.ts` — scripted integration check for success criterion #4 (10 hand-picked English ingredient names, asserts 3 candidates each, asserts no Branded Foods source)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Supabase project created, `pgvector` extension enabled, connection string works | (infra prerequisite) | One-time interactive setup in Supabase dashboard, not automatable from CI | Owner follows step-by-step setup doc in the plan; verify by running `npx drizzle-kit migrate` successfully against the connection string |
| OpenAI account created, API key generated, hard spend limit set | (infra prerequisite) | Interactive dashboard setup with billing, not automatable | Owner follows step-by-step setup doc; verify by running the indexing script against a tiny sample and confirming it succeeds without a `429`/auth error |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-11 (gsd-plan-checker: VERIFICATION PASSED, 0 blockers, 5 non-blocking documentation-hygiene warnings)
