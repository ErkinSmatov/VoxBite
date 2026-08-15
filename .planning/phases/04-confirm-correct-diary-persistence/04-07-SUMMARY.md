---
phase: 04-confirm-correct-diary-persistence
plan: 07
subsystem: application
tags: [typescript, vitest, drizzle-orm, fdc-matching, idor]

# Dependency graph
requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 04
    provides: "src/application/draft-store.ts: readDraft, updateDraftComponents, clearAwaitingInput -- all IDOR-scoped by (draftId, userId)"
  - phase: 04-confirm-correct-diary-persistence
    plan: 02
    provides: "src/domain/nutrition/calculate-total.ts (not directly imported here, but the null-safe/no-recompute conventions this plan follows)"
provides:
  - "src/application/corrections.ts: swapCandidate, adjustGrams, applyTypedGrams, removeComponent, addComponent, parseGrams, GRAM_STEP, MIN_GRAMS, MAX_GRAMS, MAX_COMPONENT_TEXT_LENGTH, CorrectionResult"
  - "src/application/corrections.test.ts: CORRECT-03..06 unit coverage against a fake db/repo/embedder"
affects: [04-08, 04-09, 04-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every correction operation re-reads the draft from Postgres via readDraft before mutating it -- a handler never passes in a cached component array (04-RESEARCH.md Pattern 1)"
    - "One shared parseGrams() feeds both the typed-grams path and the added-component path, so the nonsense-rejection rule cannot diverge between them"
    - "One shared discriminated CorrectionResult ({ok:true,components} | {ok:false,reason}) returned by every operation instead of a per-function result shape"
    - "No compare-and-swap on gram writes (accepted tradeoff, matches draft-store.ts's module header); CAS is reserved for confirm/abandon in plan 08"

key-files:
  created:
    - src/application/corrections.ts
    - src/application/corrections.test.ts

key-decisions:
  - "parseGrams rounds with Math.round (half rounds up, e.g. 200.5 -> 201) -- the one stated, test-pinned rounding rule shared by both grams-parsing call sites"
  - "addComponent uses the user's typed text verbatim as both the Russian-facing component and the English componentEn sent to the embedder -- no translation step. Documented as a stated quality risk in the code, not silently accepted: if beta matching of added components proves poor, the fix is a narrow translate-only call in a later phase, not a second matching implementation here"
  - "removeComponent on the last remaining component leaves an empty components array with status still 'draft' -- never auto-abandons or errors (D-12)"

requirements-completed: [CORRECT-03, CORRECT-04, CORRECT-05, CORRECT-06]

# Metrics
duration: 45min
completed: 2026-08-15
---

# Phase 4 Plan 07: Draft Correction Operations Summary

**`corrections.ts` -- swapCandidate/adjustGrams/applyTypedGrams/removeComponent/addComponent, all user-scoped, expiry-aware operations over the persisted draft, addComponent routed through the same matchIngredient() entry point and embedding model as the original decomposition.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (both TDD)
- **Files created:** 2

## Accomplishments

- `parseGrams(raw)` is the single grams parser shared by the typed-grams correction path and the added-component path: accepts an optional trailing `г`/`Г`/`g`/`G` unit and comma decimals, rejects non-numeric/zero/negative/out-of-range/exponential text without throwing, and rounds with a pinned `Math.round` rule.
- `swapCandidate`, `adjustGrams`, `applyTypedGrams`, `removeComponent` (CORRECT-03..05) all re-read the draft via `readDraft` (IDOR-scoped by `(draftId, userId)`), reject an expired draft via `isDraftExpired`, bounds-check every index against the actual persisted arrays, and write through `updateDraftComponents`. `removeComponent` on the last remaining component leaves `components: []` with `status` still `'draft'` -- a legitimate first-class state, not an auto-abandon (D-12).
- `addComponent` (CORRECT-06) bounds the typed text (`MAX_COMPONENT_TEXT_LENGTH = 100`, refuse-don't-truncate) BEFORE any paid call, splits a trailing numeric token into grams (defaulting to 100 g when absent), embeds once via the injected `Embedder`, and matches exclusively through `matchIngredient` -- never the decomposition LLM, never STT, never a hand-written pgvector query. An empty match result still appends the component, flagged (`chosenFdcId: null`, `weakMatch: true`), never silently dropped.
- `src/application/corrections.test.ts`: 27 tests covering every `<behavior>` line in the plan, including IDOR scoping (`not_found` for another user's draft, no write recorded), expiry, boundary clamping at `MIN_GRAMS`/`MAX_GRAMS`, the empty-draft-after-removal state, and (for `addComponent`) zero-embedder-calls assertions for over-long/empty input and exactly-one-call for a valid add.

## Task Commits

Each task was committed atomically:

1. **Task 1: parseGrams, swapCandidate, adjustGrams, applyTypedGrams, removeComponent** - `497f967` (feat)
2. **Task 2: addComponent -- text through the same FDC matching path** - `b7a65d3` (feat)

## Files Created/Modified

- `src/application/corrections.ts` -- the five exported operations, the shared `CorrectionResult` type, and the four exported constants (`GRAM_STEP`, `MIN_GRAMS`, `MAX_GRAMS`, `MAX_COMPONENT_TEXT_LENGTH`)
- `src/application/corrections.test.ts` -- 27 tests, fake-`db`/fake-`Embedder`/fake-`FdcRepository` following `draft-store.test.ts`'s tagged-condition mocking style

## Decisions Made

- `isWeakMatch` is always recomputed from the (unchanged) candidates array on a swap, never hand-compared against `WEAK_MATCH_SIMILARITY_THRESHOLD` directly -- matches the plan's "one shared rule" requirement and is asserted by grep in the acceptance criteria.
- `applyTypedGrams` runs `parseGrams` before touching the database at all: on `null` it returns immediately without a `readDraft` call, without a write, and without clearing `awaitingInput` -- the user's next message is still routed back here.
- `addComponent`'s embed-then-match failure path (embedder throws, or returns no vector) is caught, logged with only the draft id (never the typed text), and returns `match_failed` with the draft left unmodified -- `updateDraftComponents` is never reached on that path.

## Deviations from Plan

None -- plan executed exactly as written. Both accepted tradeoffs named in the plan's objective (no CAS on gram writes; `±10 г` only, no second step size) are restated in the module header as specified.

## Issues Encountered

One test-authoring correction during Task 2: the first `addComponent` test pass used a 2-dimensional fake embedding vector, which `matchIngredient`'s `assertValidEmbedding` correctly rejected (it requires exactly 1536 dims) -- all five `addComponent` tests failed with `match_failed`. Fixed by sizing the fake embedder's default vector to 1536 dims, matching the real `matchIngredient` contract; not a deviation from the plan, a test-fixture bug caught immediately by the plan's own acceptance criteria.

## User Setup Required

None -- no external service configuration required. This plan touches only application-layer TypeScript; no migration, no new environment variable.

## Next Phase Readiness

- Plan 09 (Telegram button/text handlers) can now dispatch every correction button and free-text reply directly into `swapCandidate`/`adjustGrams`/`applyTypedGrams`/`removeComponent`/`addComponent` without any further business logic -- the handler only needs to translate `callback_data`/message text into these calls' arguments and render the returned `CorrectionResult`.
- `MAX_COMPONENT_TEXT_LENGTH` is exported for plan 09's handler to reuse for its own pre-check/UX copy, so the bound is asserted in exactly one place.
- Gap noted for a later plan (not this one, per the parallel-conflict boundary with 04-08): `draft-store.ts` has no helper narrower than `updateDraftComponents` for a single-component patch: every correction op here reads the full array, mutates one element, and writes the full array back. This is intentional (matches 04-RESEARCH.md's re-read discipline) and not a gap to close.
- No blockers identified.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*

## Self-Check: PASSED

- FOUND: src/application/corrections.ts
- FOUND: src/application/corrections.test.ts
- FOUND: .planning/phases/04-confirm-correct-diary-persistence/04-07-SUMMARY.md
- FOUND commits: 497f967, b7a65d3
