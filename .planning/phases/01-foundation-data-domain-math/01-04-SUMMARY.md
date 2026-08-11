---
phase: 01-foundation-data-domain-math
plan: 04
subsystem: domain
tags: [nutrition-math, bmr, tdee, macros, tdd, vitest, pure-functions]

# Dependency graph
requires: [01-01]
provides:
  - "Pure-function nutrition domain: calculateBmr, calculateTdee, calculateTargetCalories, calculateTargetMacros, calculateNutritionTargets"
  - "All tunable nutrition constants centralized in src/domain/nutrition/constants.ts"
  - "1 kg/month rate cap and sex-specific calorie floors enforced in code"
affects: [phase-2-onboarding, phase-5-diary-views]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Domain layer has zero I/O imports (no drizzle/postgres/openai/grammy) — hexagonal purity verified by grep"
    - "Rounding happens once, at the end of each calculation pipeline, never on intermediate values"
    - "All tunable numbers live in one commented constants.ts file, never inlined in formula files"

key-files:
  created:
    - src/domain/nutrition/types.ts
    - src/domain/nutrition/constants.ts
    - src/domain/nutrition/bmr-tdee.ts
    - src/domain/nutrition/bmr-tdee.test.ts
    - src/domain/nutrition/target-calories.ts
    - src/domain/nutrition/target-calories.test.ts
    - src/domain/nutrition/target-macros.ts
    - src/domain/nutrition/target-macros.test.ts
    - src/domain/nutrition/calculate-targets.ts
    - src/domain/nutrition/calculate-targets.test.ts
    - src/domain/nutrition/index.ts
  modified: []

key-decisions:
  - "Fixed an arithmetic error in the plan's own worked example: female BMR(60,165,30) is 1320.25 (600+1031.25-150-161), not 1320.75 as written in the plan text. Implementation follows the Mifflin-St Jeor formula from TECH_SPEC §6.1 verbatim; the test literal was corrected to match."
  - "Added rateKgPerMonth to the plan's illustrative expected objects in calculate-targets.test.ts — it is a real NutritionTargets field per the <interfaces> contract that the plan's own hand-computed example tables omitted."

requirements-completed: [ONBOARD-03, ONBOARD-04]

# Metrics
duration: 35min
completed: 2026-08-11
---

# Phase 1 Plan 04: Nutrition Math Domain Layer Summary

**Pure-function BMR/TDEE/target-calorie/target-macro pipeline (Mifflin-St Jeor + activity multipliers + 1 kg/month-capped goal adjustment + fat-share-floored macro split), test-first with 57 domain tests, zero I/O.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-11
- **Tasks:** 3 completed
- **Files modified:** 11 (all new)

## Accomplishments

- `calculateNutritionTargets(profile)` is the single function Phase 2's onboarding conversation calls; it composes BMR -> TDEE -> target calories -> target macros and returns every intermediate value (`bmr`, `tdee`, `targetKcal`, `proteinG`, `fatG`, `carbsG`, `floorApplied`, `rateKgPerMonth`) so the UI can show the user how the number was derived.
- The 1 kg/month product constraint (CLAUDE.md hard constraint) is enforced inside `calculateTargetCalories` by clamping `desiredRateKgPerMonth` to `MAX_RATE_KG_PER_MONTH` — no caller, including a future API or a buggy Phase 2 keyboard, can request a faster deficit.
- The sex-specific safety floors (`CALORIE_FLOOR_FEMALE = 1200`, `CALORIE_FLOOR_MALE = 1500`) are hard-coded per TECH_SPEC §6.3, applied *after* the rate-cap adjustment, and surfaced via `floorApplied` so Phase 2 can explain an overridden deficit instead of silently showing a mismatched number.
- Every tunable nutrition number (activity multipliers, protein/fat g-per-kg presets, fat-share floor, calorie floors, rate cap, Atwater factors) lives in one commented file (`src/domain/nutrition/constants.ts`) with a Russian header telling the owner this is the only place to change nutrition numbers.
- 62 total suite tests pass (57 new nutrition tests + 5 from Plan 01), `npx tsc --noEmit` is clean, and `grep -REn "drizzle|postgres|openai|grammy|node:fs" src/domain/nutrition/` returns no matches — the module is provably zero-I/O.

## Task Commits

Each task followed strict RED -> GREEN TDD discipline:

1. **Task 1: Constants, types, and Mifflin-St Jeor BMR + TDEE** — `527ebd3` (test, RED) then `5ce6ffa` (feat, GREEN)
2. **Task 2: Goal-adjusted target calories with rate cap and safety floor** — `442e357` (test, RED) then `acb2a70` (feat, GREEN)
3. **Task 3: Target macros, composed entry point, and module barrel** — `4c8c424` (test, RED) then `b1403d4` (feat, GREEN)

## Files Created

- `src/domain/nutrition/types.ts` — `Sex`, `Goal`, `ActivityLevel`, `NutritionProfile`, `NutritionTargets` (types only, no runtime code)
- `src/domain/nutrition/constants.ts` — every tunable nutrition constant, each with a source comment: `ACTIVITY_MULTIPLIERS`, `PROTEIN_G_PER_KG`, `FAT_G_PER_KG`, `MIN_FAT_KCAL_SHARE`, `CALORIE_FLOOR_FEMALE`/`MALE`, `KCAL_PER_KG_BODY_MASS`, `DAYS_PER_MONTH`, `MAX_RATE_KG_PER_MONTH`, `MAX_RATE_KCAL_PER_DAY`, `KCAL_PER_G_{PROTEIN,FAT,CARB}`
- `src/domain/nutrition/bmr-tdee.ts` + `.test.ts` — `calculateBmr` (Mifflin-St Jeor, guards non-finite/<=0 inputs), `calculateTdee` (bmr * activity multiplier, guards unknown level); 19 tests
- `src/domain/nutrition/target-calories.ts` + `.test.ts` — `calculateTargetCalories({sex, tdee, goal, desiredRateKgPerMonth?})`; 17 tests covering all 6 sex×goal pairs, floor collisions, rate clamping
- `src/domain/nutrition/target-macros.ts` + `.test.ts` — `calculateTargetMacros(weightKg, targetKcal)`; 12 tests covering fat-share-floor engagement and carb clamp-at-zero
- `src/domain/nutrition/calculate-targets.ts` + `.test.ts` — `calculateNutritionTargets(profile)`; 7 tests including 6 hand-computed sex×goal end-to-end cases
- `src/domain/nutrition/index.ts` — public barrel re-exporting the full API and types

## Final Constant Values

| Constant | Value | Source |
|---|---|---|
| `ACTIVITY_MULTIPLIERS` | minimal 1.2, low 1.375, medium 1.55, high 1.725, very_high 1.9 | TECH_SPEC §6.2 |
| `PROTEIN_G_PER_KG` | 1.8 | D-04 default (range 1.6-2.0) |
| `FAT_G_PER_KG` | 0.9 | D-04 default (range 0.8-1.0) |
| `MIN_FAT_KCAL_SHARE` | 0.20 | TECH_SPEC §6.4 |
| `CALORIE_FLOOR_FEMALE` | 1200 | TECH_SPEC §6.3 |
| `CALORIE_FLOOR_MALE` | 1500 | TECH_SPEC §6.3 |
| `KCAL_PER_KG_BODY_MASS` | 7700 | Standard nutrition-science approximation |
| `DAYS_PER_MONTH` | 30 | — |
| `MAX_RATE_KG_PER_MONTH` | 1 | PROJECT.md/CLAUDE.md hard constraint |
| `MAX_RATE_KCAL_PER_DAY` | 257 (derived) | round(7700*1/30) |
| `KCAL_PER_G_PROTEIN` / `FAT` / `CARB` | 4 / 9 / 4 | Atwater factors |

## `calculateNutritionTargets` Signature (for Phase 2)

```ts
function calculateNutritionTargets(profile: NutritionProfile): NutritionTargets;

interface NutritionProfile {
  sex: 'male' | 'female';
  ageYears: number;
  heightCm: number;
  weightKg: number;
  activityLevel: 'minimal' | 'low' | 'medium' | 'high' | 'very_high';
  goal: 'gain' | 'loss' | 'maintain';
  desiredRateKgPerMonth?: number; // clamped to [0, 1]
}

interface NutritionTargets {
  bmr: number;
  tdee: number;
  targetKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  floorApplied: boolean;
  rateKgPerMonth: number;
}
```

Import from the barrel: `import { calculateNutritionTargets } from 'src/domain/nutrition';`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected arithmetic error in plan's worked BMR example**
- **Found during:** Task 1
- **Issue:** Plan's `<behavior>` block stated `calculateBmr('female', 60, 165, 30) === 1320.75`. Hand-computing the Mifflin-St Jeor formula from TECH_SPEC §6.1 verbatim (`10*60 + 6.25*165 - 5*30 - 161 = 600 + 1031.25 - 150 - 161`) gives `1320.25`, not `1320.75`.
- **Fix:** Implemented the formula exactly as specified in TECH_SPEC §6.1 (source of truth per the plan's own "do not re-derive" instruction). Corrected the test literal to `1320.25`.
- **Files modified:** `src/domain/nutrition/bmr-tdee.test.ts`
- **Commit:** `5ce6ffa`

**2. [Rule 1 - Bug] Added missing `rateKgPerMonth` field to hand-computed test expectations**
- **Found during:** Task 3
- **Issue:** Plan's Task 3 instructed hand-computed literal expected objects for the 6 end-to-end cases, but `rateKgPerMonth` (a real field of `NutritionTargets` per `<interfaces>`) was not included in the plan's example table, causing the first test run to fail on an extra received field.
- **Fix:** Computed and added the correct `rateKgPerMonth` value (1 for gain/loss at the default rate, 0 for maintain) to each of the 6 cases.
- **Files modified:** `src/domain/nutrition/calculate-targets.test.ts`
- **Commit:** `b1403d4`

## Known Stubs

None. All functions are fully implemented, pure, and tested.

## Known Limitations

- **0 g carbs with no warning:** `calculateTargetMacros` clamps carbs to 0 when the protein + fat presets already exceed the target calorie budget (e.g. a heavy person at the safety floor — the plan's own example, `calculateTargetMacros(120, 1500)`, hits exactly this case). This is the documented-as-intentional defensive clamp from the plan (Task 3 action notes: "the correct product response in a later phase is to warn the user rather than silently show 0 g carbs. Do not build that warning here"). No warning mechanism exists yet; a future phase (Phase 2 onboarding or later) should detect `carbsG === 0` combined with a floor-collision (`floorApplied === true`) and surface a message to the user.

## Threat Flags

None — this plan implements exactly the mitigations described in its own `<threat_model>` (T-01-14, T-01-15, T-01-16); no new security-relevant surface was introduced.

## Self-Check: PASSED

- FOUND: src/domain/nutrition/types.ts
- FOUND: src/domain/nutrition/constants.ts
- FOUND: src/domain/nutrition/bmr-tdee.ts
- FOUND: src/domain/nutrition/bmr-tdee.test.ts
- FOUND: src/domain/nutrition/target-calories.ts
- FOUND: src/domain/nutrition/target-calories.test.ts
- FOUND: src/domain/nutrition/target-macros.ts
- FOUND: src/domain/nutrition/target-macros.test.ts
- FOUND: src/domain/nutrition/calculate-targets.ts
- FOUND: src/domain/nutrition/calculate-targets.test.ts
- FOUND: src/domain/nutrition/index.ts
- FOUND commit 527ebd3, 5ce6ffa, 442e357, acb2a70, 4c8c424, b1403d4 in `git log --oneline`
- `npm test` exits 0 (62/62 passing), `npx tsc --noEmit` exits 0
- `grep -REn "drizzle|postgres|openai|grammy|node:fs" src/domain/nutrition/` returns no matches
