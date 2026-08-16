---
phase: 4
slug: confirm-correct-diary-persistence
status: approved
nyquist_compliant: true
wave_0_complete: true
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

Filled in after planning. Every row below is owned by a real task in the named plan and
carries the listed automated command in its `<automated>` verification. Status stays
`pending` until execution turns each one green.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-06 T1 | 06 | 2 | CORRECT-01 | — | N/A | unit | `npx vitest run src/bot/formatting/correction-card.test.ts` | created by 04-06 T1 | ⬜ pending |
| 04-08 T1 | 08 | 3 | CORRECT-02 | T-04-IDOR | Draft read scoped by `user_id` | unit | `npx vitest run src/application/confirm-meal.test.ts` | created by 04-08 T1 | ⬜ pending |
| 04-07 T1 | 07 | 3 | CORRECT-03 | T-04-IDOR | Swap scoped by `user_id` | unit | `npx vitest run src/application/corrections.test.ts -t swapCandidate` | created by 04-07 T1 | ⬜ pending |
| 04-07 T1 | 07 | 3 | CORRECT-04 | T-04-INPUT | Typed grams rejects non-numeric/≤0 | unit | `npx vitest run src/application/corrections.test.ts -t adjustGrams` | created by 04-07 T1 | ⬜ pending |
| 04-07 T2 | 07 | 3 | CORRECT-05 | — | Empty-state rule (D-12) | unit | `npx vitest run src/application/corrections.test.ts -t removeComponent` | created by 04-07 T2 | ⬜ pending |
| 04-07 T2 | 07 | 3 | CORRECT-06 | T-04-INPUT | Added-component text length-bounded before embedding call | unit | `npx vitest run src/application/corrections.test.ts -t addComponent` | created by 04-07 T2 | ⬜ pending |
| 04-04 T3 | 04 | 2 | CORRECT-07 | — | No in-process draft state | unit + manual restart | `npx vitest run src/application/draft-store.test.ts` | created by 04-04 T3 (extend) | ⬜ pending |
| 04-08 T2 | 08 | 3 | CORRECT-08 | T-04-DELETE | Confirm-before-delete on saved entry | unit | `npx vitest run src/application/confirm-meal.test.ts -t editSaved` | created by 04-08 T2 | ⬜ pending |
| 04-02 T1 | 02 | 1 | CALC-01 | — | No LLM in calc path | unit | `npx vitest run src/domain/nutrition/calculate-total.test.ts` | created by 04-02 T1 | ⬜ pending |
| 04-02 T1 | 02 | 1 | CALC-02 | — | Null nutrient never becomes 0 | unit | `npx vitest run src/domain/nutrition/calculate-total.test.ts -t partial` | created by 04-02 T1 | ⬜ pending |
| 04-02 T2 | 02 | 1 | DIARY-01 | — | `local_date` frozen at receipt (D-07) | unit (fake clock) | `npx vitest run src/application/local-date.test.ts` | created by 04-02 T2 | ⬜ pending |
| 04-10 T1 | 10 | 5 | D-04 (text routing gate) | T-04-ROUTE | Correction interceptor precedes Phase 3 text handler, after allowlist gate | unit | `npx vitest run src/bot/handlers/correction.test.ts src/bot/bot.wiring.test.ts` | created by 04-10 T1 | ⬜ pending |
| 04-08 T2 | 08 | 3 | D-08 (hard delete) | T-04-DELETE | Row removed only after explicit confirm | unit | `npx vitest run src/application/confirm-meal.test.ts -t delete` | created by 04-08 T2 | ⬜ pending |
| 04-04 T3 | 04 | 2 | D-11 (24h expiry) | T-04-REPLAY | Stale draft rejects button taps | unit (fake clock) | `npx vitest run src/application/draft-store.test.ts -t expire` | created by 04-04 T3 (extend) | ⬜ pending |
| 04-12 T1 | 12 | 1 | CORRECT-01..08, CALC-01, CALC-02, DIARY-01 (unblocks) | T-04-40 | `renderLevel1` output goes through `encodeCrc` only; `createMessageEditor` forwards `replyMarkup` as `{ reply_markup }` only when defined | unit | `npx vitest run src/bot/telegram/draft-card-renderer.test.ts src/bot/telegram/message-editor.test.ts && npx tsc --noEmit` | created by 04-12 T1 | ✅ green |
| 04-12 T2 | 12 | 1 | CORRECT-01..08, CALC-01, CALC-02, DIARY-01 (unblocks) | T-04-40 | Success path delivers the level-1 card + keyboard; failure/no-food paths byte-identical; `result-card.ts` retired | unit | `npx vitest run src/application/voice-pipeline.test.ts src/bot/pipeline-wiring.test.ts && test ! -f src/bot/formatting/result-card.ts && test ! -f src/bot/formatting/result-card.test.ts && test "$(grep -rl "from '.*result-card" src/ \| wc -l \| tr -d ' ')" = "0" && test "$(grep -rl "result-card" src/ \| grep -v -E 'formatting/(correction-copy\|correction-card)\.ts$' \| wc -l \| tr -d ' ')" = "0" && npx tsc --noEmit` | created by 04-12 T2 | ✅ green |
| 04-12 T3 | 12 | 1 | CORRECT-01..08, CALC-01, CALC-02, DIARY-01 (unblocks) | — | Entry-point reachability: a real pipeline run emits a `crc:` keyboard the dispatcher can receive | unit | `npx vitest run src/bot/entry-point-reachability.test.ts && npm test && npx tsc --noEmit` | created by 04-12 T3 | ✅ green |

The two mandatory manual-only verifications below remain UNDISCHARGED by this plan: 04-12
makes them reachable, it does not discharge them. CORRECT-07 (draft survives a bot restart)
and CALC-02 («нет данных» end to end) both still require the owner's repeat walkthrough of
`docs/phase-04-manual-checklist.md`.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/domain/nutrition/calculate-total.test.ts` *(owned by 04-02 T1)* — stubs for CALC-01, CALC-02, D-09
- [ ] `src/application/corrections.test.ts` *(owned by 04-07 T1/T2)* — stubs for CORRECT-03..06
- [ ] `src/application/confirm-meal.test.ts` *(owned by 04-08 T1/T2)* — stubs for CORRECT-02, CORRECT-08, D-08
- [ ] `src/application/local-date.test.ts` *(owned by 04-02 T2)* — stubs for DIARY-01, D-07
- [ ] `src/bot/formatting/correction-card.test.ts` *(owned by 04-06 T1)* — stubs for CORRECT-01, D-02/D-03/D-09 rendering
- [ ] `src/bot/handlers/correction.test.ts` *(owned by 04-09 T2)* — stubs for D-04 text-routing gate
- [ ] Extend `src/application/draft-store.test.ts` *(owned by 04-04 T3)* — CORRECT-07 persistence, D-11 expiry
- [ ] Extend `src/bot/bot.wiring.test.ts` *(owned by 04-10 T3)* — registration order of correction callback/text handlers
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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-14 (plan-check verified)
