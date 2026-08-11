---
phase: 2
slug: bot-skeleton-onboarding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `02-RESEARCH.md` → "Validation Architecture" and CONTEXT.md D-08/D-09.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (installed in Phase 1) |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run <touched-file>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds (pure unit tests, no I/O) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched-file>.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite green **and** the manual check-list document walked through and signed off (D-08)
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Each phase task must map to a row here
> before execution; rows below are pre-seeded from the research test map.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | ONBOARD-01 | — | Numeric fields rejected unless plausible; Russian re-prompt with example | unit | `npx vitest run src/bot/onboarding/parse-fields.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ONBOARD-01 | — | Complete answer set assembles a valid `NutritionProfile` for `calculateNutritionTargets` | unit | `npx vitest run src/bot/onboarding/assemble-profile.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ONBOARD-02 | — | Rate presets constant is exactly `[0.25, 0.5, 0.75, 1]` — >1 kg/month is unrepresentable in the UI | unit | `npx vitest run src/bot/keyboards/onboarding-menus.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ONBOARD-06 | — | Confirmation message body contains the non-medical-device disclaimer string | unit | `npx vitest run src/bot/formatting/onboarding-copy.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-04 / D-05 | T-02-ALLOWLIST | `parseAllowlist('')` and `parseAllowlist(undefined)` → empty set (fail-closed); malformed entries dropped, never throw | unit | `npx vitest run src/bot/middleware/allowlist.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ONBOARD-05 | T-02-REPLAY | Confirm persists profile + `onboardedAt`; restart does not persist a partial row; DB write is idempotent under conversation replay | unit or integration | `npx vitest run src/bot/onboarding/save-user.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/bot/onboarding/parse-fields.test.ts` — stubs for ONBOARD-01 field parsing
- [ ] `src/bot/onboarding/assemble-profile.test.ts` — stubs for ONBOARD-01 profile assembly
- [ ] `src/bot/keyboards/onboarding-menus.test.ts` — stubs for ONBOARD-02 rate cap
- [ ] `src/bot/formatting/onboarding-copy.test.ts` — stubs for ONBOARD-06 disclaimer
- [ ] `src/bot/middleware/allowlist.test.ts` — stubs for D-04/D-05 fail-closed allowlist
- [ ] `.planning/phases/02-bot-skeleton-onboarding/02-MANUAL-CHECKLIST.md` — the D-08 manual check-list document (exact filename is the planner's call)
- [ ] No framework install needed — Vitest configured in Phase 1

*Exact module paths depend on the planner's resolution of RESEARCH.md Open Question 1
(`src/bot/onboarding/` vs `src/application/onboarding/`). The constraint that matters:
every file in this list must be importable with **zero grammY imports** so it stays a
pure unit test (D-08, D-09).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/start` → answer all 7 fields → targets appear | ONBOARD-01 | Requires a real Telegram client and a real bot token; D-09 rejects an emulation harness | Check-list item 1 |
| Rate picker offers no option above 1 kg/month | ONBOARD-02 | Visual confirmation of the rendered inline keyboard | Check-list item 2 |
| Confirm vs "изменить" (restart onboarding) | ONBOARD-05 | End-to-end flow across two conversation runs + a DB read | Check-list item 3 |
| Disclaimer visible before targets are confirmed | ONBOARD-06 | Placement/visibility is a screen property, not a string property | Check-list item 4 |
| 409 Conflict prints plain-Russian guidance, not a stack trace | D-03 | Two-terminal, process-level scenario; explicitly excluded from automation by D-09 | Check-list item 5 — start `npm run bot` in two terminals |
| `/whoami` replies with the caller's numeric `telegram_id`; rejection logs `отказ: telegram_id=…` | D-06 | The whole point is the owner reading their own terminal | Check-list item 6 — run with an empty allowlist first |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`vitest run`, never `vitest --watch`)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
