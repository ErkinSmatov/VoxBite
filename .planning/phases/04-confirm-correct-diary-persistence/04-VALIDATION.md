---
phase: 4
slug: confirm-correct-diary-persistence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `04-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (already configured) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/domain/nutrition src/application src/bot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10-20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/domain/nutrition src/application src/bot`
- **After every plan wave:** Run `npm test` + `npx tsc --noEmit`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Task IDs are assigned by the planner; rows below are the requirement-level contract each
task must map onto. Every task claiming one of these requirements MUST carry the listed
automated command in its `<automated>` verification.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CORRECT-01 | — | N/A | unit | `npx vitest run src/bot/formatting/correction-card.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CORRECT-02 | T-04-IDOR | Draft read scoped by `user_id` | unit | `npx vitest run src/application/confirm-meal.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CORRECT-03 | T-04-IDOR | Swap scoped by `user_id` | unit | `npx vitest run src/application/corrections.test.ts -t swapCandidate` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CORRECT-04 | T-04-INPUT | Typed grams rejects non-numeric/≤0 | unit | `npx vitest run src/application/corrections.test.ts -t adjustGrams` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CORRECT-05 | — | Empty-state rule (D-12) | unit | `npx vitest run src/application/corrections.test.ts -t removeComponent` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CORRECT-06 | T-04-INPUT | Added-component text length-bounded before embedding call | unit | `npx vitest run src/application/corrections.test.ts -t addComponent` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CORRECT-07 | — | No in-process draft state | unit + manual restart | `npx vitest run src/application/draft-store.test.ts` | ❌ W0 (extend) | ⬜ pending |
| TBD | TBD | TBD | CORRECT-08 | T-04-DELETE | Confirm-before-delete on saved entry | unit | `npx vitest run src/application/confirm-meal.test.ts -t editSaved` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CALC-01 | — | No LLM in calc path | unit | `npx vitest run src/domain/nutrition/calculate-total.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CALC-02 | — | Null nutrient never becomes 0 | unit | `npx vitest run src/domain/nutrition/calculate-total.test.ts -t partial` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DIARY-01 | — | `local_date` frozen at receipt (D-07) | unit (fake clock) | `npx vitest run src/application/local-date.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-04 (text routing gate) | T-04-ROUTE | Correction interceptor precedes Phase 3 text handler, after allowlist gate | unit | `npx vitest run src/bot/handlers/correction.test.ts src/bot/bot.wiring.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-08 (hard delete) | T-04-DELETE | Row removed only after explicit confirm | unit | `npx vitest run src/application/confirm-meal.test.ts -t delete` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-11 (24h expiry) | T-04-REPLAY | Stale draft rejects button taps | unit (fake clock) | `npx vitest run src/application/draft-store.test.ts -t expire` | ❌ W0 (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/domain/nutrition/calculate-total.test.ts` — stubs for CALC-01, CALC-02, D-09
- [ ] `src/application/corrections.test.ts` — stubs for CORRECT-03..06
- [ ] `src/application/confirm-meal.test.ts` — stubs for CORRECT-02, CORRECT-08, D-08
- [ ] `src/application/local-date.test.ts` — stubs for DIARY-01, D-07
- [ ] `src/bot/formatting/correction-card.test.ts` — stubs for CORRECT-01, D-02/D-03/D-09 rendering
- [ ] `src/bot/handlers/correction.test.ts` — stubs for D-04 text-routing gate
- [ ] Extend `src/application/draft-store.test.ts` — CORRECT-07 persistence, D-11 expiry
- [ ] Extend `src/bot/bot.wiring.test.ts` — registration order of correction callback/text handlers
- No framework install needed — Vitest already configured.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two-level correction card look-and-feel on a real Telegram client | CORRECT-01..06 | Rendering/UX on a real device cannot be asserted from unit tests | Send a voice message, open the card, exercise swap / ±10 g / typed grams / remove / add, confirm the layout is readable on mobile |
| Draft survives a bot process restart mid-correction | CORRECT-07 | Requires killing and restarting the live process | Start a correction, `Ctrl-C` the bot, restart it, tap a button on the same card — state must be identical |
| `нет данных` shown for a missing-sugar FDC record end-to-end | CALC-02 | End-to-end render against real FDC data | Pick a component whose FDC record has null sugar; confirm the card and the saved entry both read `нет данных`, never `0` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
