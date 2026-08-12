---
phase: 03-voice-pipeline
plan: 04
subsystem: llm
tags: [openai, ai-sdk, zod, generateObject, dish-decomposition, tdd]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: "ai, @ai-sdk/openai, zod dependencies (Plan 01) unblocking this plan's generateObject call"
provides:
  - "src/adapters/llm/: DishDecomposer port, DecompositionSchema (Zod), DECOMPOSITION_MODEL constant, buildDecompositionPrompt, createOpenAIDecomposer"
affects: [03-voice-pipeline plan 06 (voice/text pipeline wiring, will import this port)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "port + injectable-generate adapter (mirrors src/adapters/embeddings/ and src/adapters/stt/): GenerateObjectLike accepted as opts.generate, defaulting to a real generateObject-backed wrapper — no test can make a network call"
    - "prompt isolated as a pure function (no I/O) in its own file, asserted by toContain/toMatch tests instead of living as prose"
    - "DECOMP-03 retry: catch only NoObjectGeneratedError.isInstance(err), everything else rethrows via the shared toOwnerMessage Russian-error mapping"

key-files:
  created:
    - src/adapters/llm/types.ts
    - src/adapters/llm/prompt.ts
    - src/adapters/llm/prompt.test.ts
    - src/adapters/llm/openai-decompose.ts
    - src/adapters/llm/openai-decompose.test.ts
  modified: []

key-decisions:
  - "DishDecomposer.decompose() returns Promise<Decomposition> exactly as specified in the plan's <interfaces> block (not Promise<DecompositionResult>) — kept the port contract minimal and stable for plan 03-06 to import; DecompositionResult type is exported from types.ts as documented but is not yet returned by decompose() itself (see Deviations)"
  - "DECOMPOSITION_MODEL = 'gpt-4o-mini' pinned as the single exported constant (D-16), documented as the planner's default, not a locked owner decision"
  - "grams bounded 0 < g <= 2000 (MAX_COMPONENT_GRAMS) and items capped at 15 (MAX_COMPONENTS) — hard backstops against garbage reaching Postgres, explicitly documented as NOT a plausibility claim"
  - "Prompt built as base + strict-suffix (never two divergent copies) so the retry variant cannot drift from the base variant"
  - "Transcript delimited with a triple-quote fence inside the prompt so injected 'ignore all instructions' text inside user speech cannot be mistaken for caller instructions — the Zod schema remains the real containment boundary"

patterns-established:
  - "GenerateObjectLike seam: { model: string; schema; prompt; temperature } in, { object, usage } out — lets tests fake the AI SDK without touching its real types"

requirements-completed: [DECOMP-01, DECOMP-02, DECOMP-03]

duration: 45min
completed: 2026-08-12
---

# Phase 3 Plan 4: Dish Decomposition Adapter Summary

**DishDecomposer port with a Zod schema that is simultaneously the DECOMP-03 validator and TypeScript type, a pure/tested prompt covering composite Central Asian dishes and the single-ingredient rule, and a generateObject adapter with exactly one retry on schema-invalid output.**

## Performance

- **Duration:** ~45 min (including `npm install` to populate this worktree's isolated `node_modules`)
- **Started:** 2026-08-12T11:00:00Z (approx.)
- **Completed:** 2026-08-12T11:43:25Z
- **Tasks:** 3 completed
- **Files modified:** 5 (all created)

## Accomplishments

- `src/adapters/llm/types.ts` — `DishDecomposer` port, `DecompositionSchema` (strict-structured-output-safe: zero `.optional()`/`.nullish()` calls, verified by grep gate), `DECOMPOSITION_MODEL`/`MAX_COMPONENT_GRAMS`/`MAX_COMPONENTS` constants, `DecompositionFailedError`, `DecompositionResult`
- `src/adapters/llm/prompt.ts` — `buildDecompositionPrompt(transcript, strict)`, a pure function covering D-01's composite-dish decomposition (бешбармак, куырдак, плов, манты worked examples), DECOMP-02's single-ingredient rule (банан example), TECH_SPEC §5.2's stated-weight precedence, English FDC-style naming for `component_en`, D-08's empty-answer rule, and transcript delimiting against prompt injection — 8/8 tests pass
- `src/adapters/llm/openai-decompose.ts` — `createOpenAIDecomposer()` implementing `DishDecomposer` via `generateObject` + `DecompositionSchema`, exactly one DECOMP-03 retry gated on `NoObjectGeneratedError.isInstance`, `DecompositionFailedError` on a second failure, D-08's well-formed-empty-answer path spending zero retries, Russian auth/quota error mapping mirroring `openai-embed.ts`/`openai-transcribe.ts` — 20/20 tests pass (including the Task 1 schema cases co-located here per the plan's instruction)

## Task Commits

Each task was committed atomically:

1. **Task 1: DishDecomposer port and the Zod decomposition schema** — `d2a7401` (feat) — `tdd="true"` but its behavior assertions live in Task 3's test file per the plan's explicit instruction, so this task has no standalone RED commit
2. **Task 2: The decomposition prompt as a tested pure function** — TDD cycle:
   - RED: `d3ba679` (test) — confirmed failing (`Cannot find module './prompt.js'`) before `prompt.ts` existed
   - GREEN: `f82c443` (feat) — all 8 tests pass
3. **Task 3: generateObject adapter with the single DECOMP-03 retry** — TDD cycle:
   - RED: `10425b2` (test) — confirmed failing (`Cannot find module './openai-decompose.js'`) before the adapter existed
   - GREEN: `fbe96b0` (feat) — all 20 tests pass, including a mid-GREEN fix to a test-authoring bug (see Deviations)

**Plan metadata:** (this commit, immediately following)

## TDD Gate Compliance

Tasks 2 and 3 (`tdd="true"`) followed the RED/GREEN cycle correctly:
- Task 2: `d3ba679` (test, confirmed failing) → `f82c443` (feat, all green). No refactor needed.
- Task 3: `10425b2` (test, confirmed failing) → `fbe96b0` (feat, all green, includes the test-bug fix below). No refactor needed.
- Task 1 has no standalone RED/GREEN pair — the plan explicitly instructs writing Task 1's schema assertions "as tests inside `src/adapters/llm/openai-decompose.test.ts` (created in Task 3) rather than a separate file", so Task 1 is committed as a single `feat` and its behavior is verified by Task 3's RED/GREEN cycle instead.

## Files Created/Modified

- `src/adapters/llm/types.ts` - `DishDecomposer`, `DecompositionSchema`, `DECOMPOSITION_MODEL`, `MAX_COMPONENT_GRAMS`, `MAX_COMPONENTS`, `DecompositionFailedError`, `DecompositionResult`
- `src/adapters/llm/prompt.ts` - `buildDecompositionPrompt(transcript, strict)`, pure function, imports only from `./types.js`
- `src/adapters/llm/prompt.test.ts` - 8 tests asserting the prompt's content
- `src/adapters/llm/openai-decompose.ts` - `createOpenAIDecomposer()`, `GenerateObjectLike` injectable seam, `CreateOpenAIDecomposerOptions`
- `src/adapters/llm/openai-decompose.test.ts` - 20 tests: adapter retry/error-mapping behavior plus Task 1's schema cases

## Decisions Made

- Kept `DishDecomposer.decompose()` returning `Promise<Decomposition>` exactly as the plan's `<interfaces>` block specifies (the literal contract plan 03-06 will import), even though the plan's Task 3 `<action>` text also describes "returning `DecompositionResult`" for the D-17 cost line. Resolved the tension by exporting `DecompositionResult` from `types.ts` (as the interfaces block requires) without wiring it through the port's return type, keeping the documented downstream contract stable. See Deviations for the tradeoff this leaves open.
- Copied the `toOwnerMessage`/error-shape-duck-typing helper into `openai-decompose.ts` rather than importing it from `openai-embed.ts`/`openai-transcribe.ts`, matching the existing convention of not sharing helpers across adapter boundaries (as `openai-transcribe.ts` already does relative to `openai-embed.ts`).
- Prompt transcript delimiter uses a triple-quote (`"""`) fence rather than XML-style tags — either satisfies the "explicit fenced marker" requirement; triple-quote was chosen to match the plain, non-markup Russian house style used elsewhere in the repo's user-facing and prompt text.

## Deviations from Plan

**1. [Clarification, not a Rule 1-4 deviation] `DecompositionResult` exported but not yet returned by `decompose()`**
- **Found during:** Task 3, while reconciling the plan's `<interfaces>` block (`decompose(): Promise<Decomposition>`) against the Task 3 `<action>` prose ("Return `DecompositionResult` carrying decomposition, usage, model... so plan 03-06's cost line (D-17) has real token counts").
- **Resolution:** Followed the `<interfaces>` block literally since it is explicitly marked as the contract "plan 03-06 imports" — `decompose()` returns `Decomposition`. `DecompositionResult` is exported from `types.ts` as specified, and the adapter's internal `attempt()` helper does receive the full `{ object, usage }` shape from `generate()`, but that usage value is currently discarded rather than surfaced through the port.
- **Impact:** Plan 03-06 will need to either (a) accept that no real token-usage numbers are available from this port and use an estimate instead, or (b) this plan's port may need a follow-up widening (`decompose(): Promise<DecompositionResult>`) once 03-06 is planned and the tradeoff is revisited with fresh context. Flagging explicitly rather than silently picking one interpretation.
- **Files affected:** `src/adapters/llm/types.ts`, `src/adapters/llm/openai-decompose.ts`
- **Commits:** `d2a7401`, `fbe96b0`

**2. [Test-authoring bug, fixed during GREEN] Two-response fake reused across two `decompose()` calls**
- **Found during:** Task 3 GREEN — first test run of the "throws DecompositionFailedError after exactly two generate calls" test failed because the test called `decompose()` twice against a fake `generate` that only had 2 canned responses queued (needing 4).
- **Fix:** Split the test into two: one asserting the rejection is `instanceof DecompositionFailedError` with exactly 2 generate calls, another (with its own fresh fake) asserting the message is `'DECOMPOSITION_FAILED'`.
- **Files modified:** `src/adapters/llm/openai-decompose.test.ts`
- **Commit:** `fbe96b0` (folded into the GREEN commit, not a separate commit, since the RED commit for this file had already been made and this was mid-cycle test correction, not implementation).

## Issues Encountered

- This worktree had no `node_modules` (isolated worktree, gitignored). Ran `npm install` before starting Task 1 to make `ai`/`@ai-sdk/openai`/`zod` (installed in plan 03-01) resolvable here; `package-lock.json` picked up a cosmetic caret-range-to-exact-pin normalization diff from that install (`^4.0.40` → `4.0.40` etc.) but this is npm re-normalizing to match `package.json`'s already-pinned versions, not a dependency change — left uncommitted/unstaged in every task commit since it is not a task deliverable.

## User Setup Required

None — no external service configuration required. `OPENAI_API_KEY` was already required from Phase 1; this plan adds no new environment variable (the model name stays a code constant, per D-16, matching Plan 01's STT precedent).

## Next Phase Readiness

- `DishDecomposer` port and `createOpenAIDecomposer()` are ready for plan 03-06 to wire into the voice/text pipeline
- `buildDecompositionPrompt` is independently testable and can be iterated on without touching the adapter
- Open item for 03-06 planning: decide whether `decompose()` needs to surface `DecompositionResult`'s usage data for the D-17 cost line, or whether an estimate suffices (see Deviations #1)
- No blockers identified

---
*Phase: 03-voice-pipeline*
*Completed: 2026-08-12*
