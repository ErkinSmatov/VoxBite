---
phase: 1
slug: foundation-data-domain-math
status: draft
nyquist_compliant: false
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
| 01-01-xx | 01 | 0 | — | — | Vitest configured and runnable | infra | `npx vitest --version && npx vitest run` (empty pass) | ❌ W0 | ⬜ pending |
| 01-0x-xx | TBD | TBD | ONBOARD-03 | — | BMR + TDEE + rate cap + safety floor correct across sex × goal | unit | `npx vitest run domain/nutrition/bmr-tdee.test.ts domain/nutrition/target-calories.test.ts` | ❌ W0 | ⬜ pending |
| 01-0x-xx | TBD | TBD | ONBOARD-04 | — | Target macro grams from calories + presets, incl. carbs-clamp edge case | unit | `npx vitest run domain/nutrition/target-macros.test.ts` | ❌ W0 | ⬜ pending |
| 01-0x-xx | TBD | TBD | MATCH-01 | T-01-01 | `matchIngredient()` returns top-N candidates via repository port (fake repo) | unit | `npx vitest run domain/fdc-matching/match-ingredient.test.ts` | ❌ W0 | ⬜ pending |
| 01-0x-xx | TBD | TBD | MATCH-01 | T-01-01 | Real pgvector query returns 3 plausible candidates for 10 hand-picked names | scripted integration | `npx tsx scripts/index-fdc/verify-matches.ts` | ❌ W0 | ⬜ pending |
| 01-0x-xx | TBD | TBD | MATCH-02 | T-01-02 | Indexing pipeline filters to `data_type='foundation_food'` only, never writes Branded/non-foundation rows | unit + integration | `npx vitest run scripts/index-fdc/parse-foundation.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Plan/Wave/Task IDs finalized once gsd-planner writes PLAN.md — this table is pre-populated from RESEARCH.md's requirement→test map and updated then.*

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
