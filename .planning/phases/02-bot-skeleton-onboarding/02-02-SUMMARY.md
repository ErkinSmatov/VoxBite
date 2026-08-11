---
phase: 02-bot-skeleton-onboarding
plan: 02
subsystem: onboarding
tags: [vitest, tdd, nutrition-domain, russian-copy, typescript]

# Dependency graph
requires:
  - phase: 01-foundation-data-domain-math
    provides: "src/domain/nutrition barrel (calculateNutritionTargets, NutritionProfile, NutritionTargets, Sex, Goal, ActivityLevel, MAX_RATE_KG_PER_MONTH, ACTIVITY_MULTIPLIERS)"
provides:
  - "Pure, tested parse/validate for typed numeric onboarding fields (age/height/weight) with Russian re-prompts"
  - "Button option lists (sex/activity/goal/timezone) with allowlisted callback_data decoding"
  - "Rate presets (0.25/0.5/0.75/1 kg/month) structurally bound to MAX_RATE_KG_PER_MONTH"
  - "OnboardingAnswers -> NutritionProfile assembly with explicit destructure (no timezone leak)"
  - "All Russian onboarding copy incl. the ONBOARD-06 non-medical-device disclaimer draft"
affects: ["02-05 (onboarding conversation orchestration)", "02-07 (disclaimer copy owner sign-off)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ParseResult<T> discriminated union for user-text parsing that must never throw"
    - "callback_data allowlist decoding (lookup against known Option list, never split+cast)"
    - "Three-layer rate cap defense (UI preset list -> domain clamp -> DB check constraint), bound together by a test asserting equality"

key-files:
  created:
    - src/bot/onboarding/parse-fields.ts
    - src/bot/onboarding/parse-fields.test.ts
    - src/bot/onboarding/options.ts
    - src/bot/onboarding/options.test.ts
    - src/bot/onboarding/rate-presets.ts
    - src/bot/onboarding/rate-presets.test.ts
    - src/bot/onboarding/assemble-profile.ts
    - src/bot/onboarding/assemble-profile.test.ts
    - src/bot/formatting/onboarding-copy.ts
    - src/bot/formatting/onboarding-copy.test.ts
  modified: []

key-decisions:
  - "Age 10-100, height 100-250cm, weight 30-300kg (one decimal, '.' or ',') as plausibility bounds — named module constants in parse-fields.ts, quotable in error text"
  - "RATE_PRESETS_KG_PER_MONTH kept as a literal [0.25,0.5,0.75,1] tuple rather than referencing MAX_RATE_KG_PER_MONTH directly in the array, with a dedicated test asserting equality — this was required to satisfy the plan's literal-pattern verification script while still guarding against domain/UI drift"
  - "Timezone list limited to 6 realistic options for the closed beta (Asia/Almaty, Asia/Aqtobe, Asia/Tashkent, Europe/Moscow, Asia/Dubai, Europe/Berlin), default Asia/Almaty"

patterns-established:
  - "Onboarding logic under src/bot/onboarding and src/bot/formatting has zero grammY imports (D-08) — verified by a repo-grep and per-module node script check"

requirements-completed: [ONBOARD-01, ONBOARD-02, ONBOARD-06]

# Metrics
duration: 5min
completed: 2026-08-11
---

# Phase 02 Plan 02: Onboarding Domain Logic Summary

**Pure, fully-tested onboarding logic (numeric parsing, button options, rate presets, profile assembly, Russian copy incl. disclaimer) with zero grammY imports, ready for Plan 05's conversation to orchestrate**

## Performance

- **Duration:** ~5 min (first commit 21:27:11, last commit 21:30:35)
- **Started:** 2026-08-11T21:27:11+05:00
- **Completed:** 2026-08-11T21:30:35+05:00
- **Tasks:** 3
- **Files modified:** 10 (all new)

## Accomplishments
- Typed age/height/weight parsing that never throws, rejects malformed/out-of-range input with a Russian re-prompt containing a concrete example number
- Every button choice (sex, 5 activity levels, 3 goals, 6 timezones) is a typed, tested constant; every `callback_data` decodes through a closed allowlist, returning `undefined` for forged or cross-list values
- Weight-change rate is structurally capped: only 0.25/0.5/0.75/1 kg/month are selectable, and a test binds the top preset to the domain's `MAX_RATE_KG_PER_MONTH` so the two layers cannot drift apart
- `assembleProfile` composes a real `NutritionProfile` that `calculateNutritionTargets` accepts (verified against the real function, not a mock), explicitly destructures so `timezone` cannot leak into the domain object, and omits `desiredRateKgPerMonth` for `maintain`
- All Russian onboarding copy lives in one module, including the ONBOARD-06 non-medical-device disclaimer, composed into the confirmation message after the calculated numbers

## Task Commits

Each task followed RED -> GREEN TDD:

1. **Task 1: Pure parsing for the three typed numeric fields**
   - `2e111e7` test(02-02): add failing tests for onboarding numeric field parsing
   - `10d7e47` feat(02-02): implement pure numeric field parsing with Russian re-prompts
2. **Task 2: Button options and rate presets with allowlisted callback_data decoding**
   - `ce98b8f` test(02-02): add failing tests for onboarding options and rate presets
   - `9420a08` feat(02-02): implement onboarding options and rate presets with allowlisted decoding
3. **Task 3: Profile assembly and all Russian onboarding copy incl. the ONBOARD-06 disclaimer**
   - `1cf5b82` test(02-02): add failing tests for profile assembly and onboarding copy
   - `34b9072` feat(02-02): implement profile assembly and Russian onboarding copy

_No refactor commits needed — GREEN implementations satisfied all acceptance criteria on the first pass._

## Files Created/Modified
- `src/bot/onboarding/parse-fields.ts` - `parseAge`/`parseHeight`/`parseWeight` returning `ParseResult<number>`, named bound constants (AGE_MIN/MAX, HEIGHT_MIN/MAX_CM, WEIGHT_MIN/MAX_KG)
- `src/bot/onboarding/parse-fields.test.ts` - 41 `it.each` cases across boundary values, decimal-comma weight, non-numeric/empty/Infinity input
- `src/bot/onboarding/options.ts` - `SEX_OPTIONS`, `ACTIVITY_OPTIONS`, `GOAL_OPTIONS`, `TIMEZONE_OPTIONS`, `DEFAULT_TIMEZONE`, `decodeOption`
- `src/bot/onboarding/options.test.ts` - option-shape, callback_data uniqueness/64-byte-limit, allowlist decode tests
- `src/bot/onboarding/rate-presets.ts` - `RATE_PRESETS_KG_PER_MONTH`, `decodeRate`
- `src/bot/onboarding/rate-presets.test.ts` - deep-equal + `MAX_RATE_KG_PER_MONTH` regression guard, forged-rate decode tests
- `src/bot/onboarding/assemble-profile.ts` - `OnboardingAnswers`, `assembleProfile`
- `src/bot/onboarding/assemble-profile.test.ts` - real-domain-call, timezone-leak, and maintain/gain/loss presence tests
- `src/bot/formatting/onboarding-copy.ts` - `DISCLAIMER_TEXT`, `targetsWithDisclaimerMessage`, `questionCopy`
- `src/bot/formatting/onboarding-copy.test.ts` - disclaimer substring/position, floor-applied line, rate line, questionCopy example-number tests

## Decisions Made
- `RATE_PRESETS_KG_PER_MONTH`'s top value is a literal `1`, not a direct reference to `MAX_RATE_KG_PER_MONTH`, because the plan's own automated verify script pattern-matches the literal sequence `0.25, 0.5, 0.75, 1` in the file text. The drift-guard is instead enforced by `rate-presets.test.ts` asserting `Math.max(...RATE_PRESETS_KG_PER_MONTH) === MAX_RATE_KG_PER_MONTH`, which fails the suite the moment either constant changes without the other.
- Activity level labels each pair the level name with a concrete everyday description (e.g. "Минимальная — сидячая работа, почти нет движения") per TECH_SPEC §6.2, verified by a test asserting `label.length > value.length`.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria were met without needing Rule 1-4 fixes.

## Disclaimer draft (verbatim, for Plan 07's owner sign-off)

```
⚠️ Важно: VoxBite — не медицинское изделие. Расчёт целевых калорий и БЖУ
сделан по общей формуле (Миффлина-Сан Жеора) и носит справочный характер.
Он не учитывает заболевания, приём лекарств, беременность и другие
индивидуальные особенности. Бот не ставит диагнозов и не назначает
лечение. Перед тем как менять питание, посоветуйся с врачом или
дипломированным диетологом.
```

## Plausibility bounds chosen

| Field | Min | Max | Notes |
|-------|-----|-----|-------|
| Age (years) | 10 | 100 | integer only |
| Height (cm) | 100 | 250 | integer only, rejects metres-style `1.78` |
| Weight (kg) | 30 | 300 | one decimal allowed, `.` or `,` separator, rounded to 1 decimal |

## Timezone list

`Asia/Almaty` (default), `Asia/Aqtobe`, `Asia/Tashkent`, `Europe/Moscow`, `Asia/Dubai`, `Europe/Berlin` — each validated at test time against `Intl.DateTimeFormat`.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required. This plan is pure TypeScript logic with no new dependencies.

## Next Phase Readiness

- `src/bot/onboarding/*` and `src/bot/formatting/*` are ready for Plan 05's `@grammyjs/conversations` orchestration to consume via the documented `<interfaces>` contract.
- Plan 07 needs the `DISCLAIMER_TEXT` draft above for the owner's explicit sign-off before the wording is considered final.
- No blockers for this plan's scope. `npm test` (whole repo, 252 tests) and `npx tsc --noEmit` both pass.

## Self-Check: PASSED

All 10 created files verified present on disk; all 6 task commits (2e111e7, 10d7e47, ce98b8f, 9420a08, 1cf5b82, 34b9072) verified present in git log.

---
*Phase: 02-bot-skeleton-onboarding*
*Completed: 2026-08-11*
