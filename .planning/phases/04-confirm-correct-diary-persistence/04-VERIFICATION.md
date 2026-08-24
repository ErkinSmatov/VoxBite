---
phase: 04-confirm-correct-diary-persistence
verified: 2026-08-16T00:00:00Z
status: human_needed
score: 11/11 must-haves verified (code + automated); 1 of 12 manual walkthrough scenarios recorded skipped, not passed
overrides_applied: 0
human_verification:
  - test: "Tap any button on a correction card older than 24 hours (D-11)"
    expected: "Bot answers with the expiry message (\"этот разбор устарел, отправь сообщение заново\") and the keyboard is removed"
    why_human: "No card old enough to test existed on implementation day (04-UAT.md scenario 12, recorded as skipped, not passed). The expiry predicate itself (`isDraftExpired` in src/application/types.ts) is unit-tested with a fake clock in draft-store.test.ts and correction.test.ts — what remains unverified is only the on-device Telegram presentation of an actually-stale card."
---

# Phase 4: Confirm/correct + diary persistence Verification Report

**Phase Goal:** Users can review, correct, and confirm a decomposed meal, and the confirmed
entry is calculated deterministically and durably saved — this is where the product becomes
trustworthy per Core Value.
**Verified:** 2026-08-16
**Status:** human_needed
**Re-verification:** No — initial verification (first `04-VERIFICATION.md` for this phase)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User receives a card showing each decomposed component, its gram estimate, and its matched FDC record, and can confirm it as-is (CORRECT-01/02). | VERIFIED | `src/application/voice-pipeline.ts:290-291` calls `deps.cardRenderer.renderLevel1(...)` and `deps.editor.editMessage(..., card.text, card.replyMarkup)` — the **entry point** itself now emits the Phase 4 card+keyboard, not a Phase 3 read-only card. Confirmed by `src/bot/entry-point-reachability.test.ts`, sourced from the real composition root (`buildMealHandlerDeps` in `pipeline-wiring.ts`), which fails if the renderer is swapped out. |
| 2 | User can swap the matched FDC candidate, adjust grams (±10 g or typed), remove a component, or add one by text matched through the same FDC search (CORRECT-03..06). | VERIFIED | `src/application/corrections.ts` implements `swapCandidate`/`adjustGrams`/`removeComponent`/`addComponent`; `addComponent` calls `matchIngredient()` (the sanctioned single entry point), not hand-rolled SQL — confirmed by reading the import in `corrections.ts`. Exercised in `corrections.test.ts`. UAT round 2 tests 2-6 passed live. |
| 3 | Correction draft state is stored in Postgres, not process memory, and survives a bot restart mid-correction (CORRECT-07/D-04). | VERIFIED | `diary_drafts.awaiting_input` (jsonb) column exists live (confirmed by direct `information_schema` query against the Supabase database, see Data-Flow Trace) and is read/written exclusively through `draft-store.ts`'s `setAwaitingInput`/`clearAwaitingInput`/`findAwaitingDraft` — no module-level state anywhere in `src/application/`. UAT round 2 test 6 (manual-only, live Ctrl-C + restart) passed. |
| 4 | Final calories/protein/fat/carbs/sugar are computed purely mathematically (grams × FDC per-100g, no LLM) and saved to the diary for the correct day; a missing sugar value shows "нет данных," never 0 or guessed (CALC-01/CALC-02/DIARY-01). | VERIFIED | `src/domain/nutrition/calculate-total.ts` — pure function, `(grams/100) × perHundred`, summed only over non-null values, `missingCount` tracked per nutrient, never substitutes 0. Its only two callers with side effects are `confirm-meal.ts:196` (initial save) and `:279` (edit); `correction-card.ts:75` uses the SAME function for the `≈` preview (D-03's one-function rule). `local-date.ts`'s `deriveLocalDate` has exactly one call site (`voice-pipeline.ts:278`), frozen from the message's own `receivedAt`, never touched again by `recomputeSavedEntry` (explicit comment + omitted from its UPDATE payload). UAT round 2 tests 7 and 9 (both manual-only mandatory verifications) passed live. |
| 5 | User can edit or delete an already-saved diary entry using the same correction mechanics (CORRECT-08/D-08). | VERIFIED | `recomputeSavedEntry` in `confirm-meal.ts` re-runs `calculateTotal` over the same draft row and UPDATEs the linked `diary` row, deliberately omitting `local_date`. `deleteSavedEntry` requires `claimAbandon(..., fromStatus: 'confirmed')` (CAS) before a real `DELETE`. UAT round 2 tests 10 and 11 passed live (Да/Нет confirmation, hard delete, `local_date` unchanged on edit). |

**Score:** 5/5 roadmap success criteria VERIFIED in code and cross-checked live where a manual step was mandatory. See Deferred/Human Verification below for the one walkthrough item that could not be exercised.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/domain/nutrition/calculate-total.ts` | CALC-01/CALC-02 pure arithmetic | VERIFIED | Substantive: validates inputs, sums only present values, never coerces null→0, unrounded floats per its own documented rounding rule. Wired: two production callers in `confirm-meal.ts`, one formatting caller in `correction-card.ts`. |
| `src/application/local-date.ts` | DIARY-01/D-07 frozen day | VERIFIED | `deriveLocalDate` has exactly one call site (`voice-pipeline.ts:278`), invoked once per pipeline run against `args.receivedAt`; never re-invoked on confirm or edit. |
| `src/application/draft-store.ts` | IDOR-scoped, CAS-protected draft CRUD | VERIFIED | Every function filters `and(eq(id, draftId), eq(userId, userId))`; no unscoped overload exists. `claimConfirm`/`claimAbandon` use conditional `UPDATE ... WHERE status = <expected> RETURNING id` (true CAS, not a read-then-write race). |
| `src/application/confirm-meal.ts` | Confirm/edit/delete with D-06/D-07/D-08/D-10 rules | VERIFIED | `confirmMeal` blocks on `findBlockingComponent` (D-10), refuses `local_date IS NULL` and expired/already-confirmed drafts, calls `claimConfirm` before insert. `deleteSavedEntry` requires an explicit second confirm upstream (handler-level Да/Нет) before `claimAbandon`. |
| `src/db/schema/diary.ts` / `diary-drafts.ts` | D-06 no `diary_items` table; denormalised totals + `draft_id` back-link | VERIFIED | `grep -rn "diary_items" src/` returns only a doc-comment explaining why it was rejected — no such table or type exists. `diary.draftId` is `notNull`; `diary_drafts.diaryId` nullable back-link set post-insert. |
| `src/bot/telegram/draft-card-renderer.ts` | Bot-layer port implementation keeping grammY out of `application/` | VERIFIED | Constructed once in `pipeline-wiring.ts:85` and injected into `PipelineDeps`; `application/types.ts` still imports no grammY (unchanged rule). |
| `src/bot/formatting/result-card.ts` | Retired per 04-12 | VERIFIED (absence confirmed) | File does not exist. Zero references anywhere except doc comments in `correction-card.ts`/`correction-copy.ts` that explain the retirement. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `voice-pipeline.ts` (entry point) | `crc:` correction UI | `deps.cardRenderer.renderLevel1()` → `deps.editor.editMessage(..., card.replyMarkup)` | WIRED | This is the exact seam that was broken in round 1 of the UAT (blocker). Independently re-checked by reading the current file: the card and keyboard are now built and delivered from the pipeline's success path, not only from `crc:` callback handlers. `entry-point-reachability.test.ts` asserts this against the real composition root and is designed to fail if `pipeline-wiring.ts` is ever swapped back. |
| `message-editor.ts` | Telegram `editMessageText` | conditional 4th-argument forwarding | WIRED | `replyMarkup !== undefined` → passes `{ reply_markup }`; `undefined` → calls with exactly 3 args (old failure-path behavior preserved byte-for-byte). Verified by reading the file; `message-editor.test.ts` asserts both branches. |
| `correction.ts` handlers | `draft-store.ts` / `confirm-meal.ts` | scoped reads before every action | WIRED | Handler re-reads the draft from Postgres on every callback rather than trusting keyboard-implied state (CORRECT-07 requirement, confirmed by reading `readDraft` calls preceding every branch in `correction.ts`). |
| `diary_drafts.local_date` / `diary.draft_id` | live Supabase schema | migration 0007 | WIRED (independently verified) | Direct `information_schema.columns` query against the live `DATABASE_URL` (run by this verifier, not taken from SUMMARY claims) confirms all four Phase 4 columns exist with correct nullability; `drizzle.__drizzle_migrations` count is 8, matching the 8 files in `drizzle/`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `diary_drafts.awaiting_input` | `DraftAwaitingInput \| null` | live DB column, read via `findAwaitingDraft`/`readDraft` | Yes — confirmed present in live schema, jsonb, nullable | FLOWING |
| `diary.kcal/protein_g/fat_g/carbs_g/sugar_g` | `NutrientTotal` from `calculateTotal()` | grams × FDC per-100g values from `draft.components`, all real (not mocked/static) at the type/wiring level | Yes at the code level; end-to-end real-FDC-data confirmation for the null-sugar case was done live in UAT round 2 test 7 | FLOWING |
| `diary.local_date` | `deriveLocalDate(args.receivedAt, args.timezone)` | frozen at pipeline run time, copied unchanged through confirm/edit | Yes | FLOWING |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| CORRECT-01 | 04-01, 04-03, 04-06, 04-09, 04-11, 04-12 | Card shows decomposition, per-component buttons | SATISFIED | Reachable from entry point (see Key Link 1); rendered by `correction-card.ts`/`correction-keyboards.ts`; live-tested UAT test 1. |
| CORRECT-02 | 04-01, 04-04, 04-08, 04-09, 04-11 | Confirm as-is | SATISFIED | `confirmMeal()`; UAT test 9. |
| CORRECT-03 | 04-06, 04-07, 04-09, 04-11 | Swap FDC candidate | SATISFIED | `swapCandidate()` in `corrections.ts`; UAT test 2. |
| CORRECT-04 | 04-06, 04-07, 04-09, 04-10, 04-11 | Adjust grams ±10g/typed | SATISFIED | `adjustGrams()`; typed-input gate in `correction.ts`/D-04; UAT test 3. |
| CORRECT-05 | 04-03, 04-06, 04-07, 04-09, 04-11 | Remove component, empty state | SATISFIED | `removeComponent()`; D-12 empty-state copy in `correction-card.ts:131-135`; UAT test 4. |
| CORRECT-06 | 04-07, 04-10, 04-11 | Add component by text via same FDC search | SATISFIED | `addComponent()` calls `matchIngredient()`; UAT test 5. |
| CORRECT-07 | 04-01, 04-04, 04-10, 04-11 | Draft state in Postgres, survives restart | SATISFIED | No module-level state in `application/`; `awaiting_input` column live; UAT test 6 (mandatory manual, passed). |
| CORRECT-08 | 04-01, 04-04, 04-08, 04-09, 04-11 | Edit/delete a saved entry | SATISFIED | `recomputeSavedEntry`/`deleteSavedEntry`; UAT tests 10-11. |
| CALC-01 | 04-02, 04-08 | Pure arithmetic, no LLM | SATISFIED | `calculate-total.ts`; single-function invariant enforced (D-03). |
| CALC-02 | 04-02, 04-06, 04-08, 04-11 | Null sugar never becomes 0 | SATISFIED | `missingCount`/`null` handling in `calculate-total.ts`; UAT test 7 (mandatory manual, passed). |
| DIARY-01 | 04-01, 04-02, 04-05, 04-08, 04-11 | Confirmed entry saved to diary, correct day | SATISFIED | `deriveLocalDate` single call site; `diary` insert in `confirmMeal`; UAT test 9. |

No orphaned requirement IDs found — `REQUIREMENTS.md`'s Phase 4 row list (CORRECT-01..08, CALC-01, CALC-02, DIARY-01) is fully covered by plan frontmatter. Note: `REQUIREMENTS.md`'s own tracking table still marks all of these (and all of Phase 3's) as "Pending" — this is a stale bookkeeping table, not evidence against the phase; every Phase 3 requirement shows the same stale "Pending" despite Phase 3 being merged and built upon. Recommend a housekeeping pass on `REQUIREMENTS.md`, not a phase gap.

### Anti-Patterns Found

Scanned every `.ts` file touched since 2026-08-14 (the phase's start date) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon". **Zero matches.** No blockers or warnings from this scan.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Typecheck clean | `npx tsc --noEmit` | exit 0 | PASS |
| Full test suite | `npm test` | 51 files, 680/680 passed | PASS |
| Entry point emits `crc:` keyboard | `entry-point-reachability.test.ts` (part of full suite) | passed, sourced from real composition root | PASS |
| Live schema has Phase 4 columns | Direct `information_schema.columns` query against `DATABASE_URL` (run by this verifier) | all 4 columns present with correct types/nullability; migration journal count = 8 | PASS |
| No `diary_items` table exists anywhere | `grep -rn "diary_items" src/` | only doc-comment hits, no schema/type definition | PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention and none is referenced in any PLAN/SUMMARY. Skipped.

### Human Verification Required

### 1. 24-hour draft expiry, on-device presentation (D-11)

**Test:** Wait until (or otherwise arrange for) a correction card to be more than 24 hours old, then tap any of its buttons.
**Expected:** The bot answers with the expiry message ("этот разбор устарел, отправь сообщение заново") and the message's keyboard is removed.
**Why human:** No draft old enough to exercise this existed on the implementation day; `04-UAT.md` scenario 12 is explicitly recorded as *skipped*, not passed — the owner's own checklist permits recording this as untested rather than fabricating a pass. This verifier did not upgrade that skip to a pass. The underlying rule (`isDraftExpired`) is unit-tested with a fake clock in `draft-store.test.ts` and `correction.test.ts`, so the logic is verified; only its live Telegram presentation (message text + keyboard removal on an actually-stale card) remains unconfirmed.

### Gaps Summary

No code-level gaps found. Every roadmap Success Criterion (1-5) and every requirement ID
(CORRECT-01..08, CALC-01, CALC-02, DIARY-01) has direct, re-read evidence in the current
codebase — not just SUMMARY claims. The Round 1 blocker (Phase 4 UI unreachable from the
product's entry point) was independently re-verified as fixed: `voice-pipeline.ts` now renders
and delivers the `crc:` keyboard directly from the pipeline's success path, sourced through the
real composition root, and covered by a reachability tripwire designed to fail if that wiring
regresses. The live Supabase database was queried directly (not taken on SUMMARY's word) and
confirms migration 0007 is applied with all four Phase 4 columns present.

The only open item is the D-11 24-hour expiry's on-device presentation, which the owner's own
UAT explicitly could not exercise (no draft could be old enough on the day the feature shipped)
and honestly recorded as skipped rather than passed. That is not a code gap — the expiry
predicate is unit-tested — but it is also not something this verifier can responsibly upgrade to
"passed" without evidence. It is routed to human verification, matching the instruction to judge
this honestly rather than pass over it silently or fail the phase for a scenario that could not
physically exist yet.

---

*Verified: 2026-08-16*
*Verifier: Claude (gsd-verifier)*
