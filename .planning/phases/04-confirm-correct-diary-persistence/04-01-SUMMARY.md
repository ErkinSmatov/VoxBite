---
phase: 04-confirm-correct-diary-persistence
plan: 01
subsystem: database
tags: [drizzle-orm, postgresql, migrations, schema]

# Dependency graph
requires:
  - phase: 03-voice-pipeline
    provides: diary_drafts table (D-19) and the message_id/transcript/components columns Phase 4's correction UI reads and writes
provides:
  - diary_drafts.awaiting_input (D-04) — durable "waiting for this free-text reply" flag
  - diary_drafts.local_date (D-07, nullable) — frozen calendar day for the meal
  - diary_drafts.diary_id (D-06) — back-link set on confirm
  - diary.draft_id NOT NULL (D-06) — forward-link from a saved entry to its working-copy draft
  - Applied migration 0007 (4 ADD COLUMN + 2 FK constraints)
affects: [04-02, 04-03, 04-04, 04-05, 04-06, 04-07, 04-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-table Drizzle FK cycle broken with `.references((): AnyPgColumn => ...)` typed lazy references (both diary.ts and diary-drafts.ts point at each other)"

key-files:
  created:
    - drizzle/0007_whole_stranger.sql
    - drizzle/meta/0007_snapshot.json
  modified:
    - src/db/schema/diary-drafts.ts
    - src/db/schema/diary.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "diary_drafts.local_date is nullable (not notNull) — pre-Phase-4 rows have no honest day to backfill; Phase 4's write path always sets it, and confirm() must reject a null local_date the same way it rejects a stale draft"
  - "diary.draft_id is NOT NULL — diary only ever gets a row via confirmation (D-05/D-06), never independently"
  - "Circular FK between diary and diary_drafts resolved with drizzle's documented AnyPgColumn lazy-reference pattern on both sides, not the plan's fallback foreignKey()-in-extras approach (that still hit the same TS7022 circular-inference error since it also requires a top-level cross-import)"

patterns-established:
  - "Every new nullable-for-a-documented-reason column gets its tradeoff written directly in the column's doc comment, not just in CONTEXT.md — see local_date's comment"

requirements-completed: [CORRECT-07, CORRECT-02, DIARY-01]

# Metrics
duration: 20min
completed: 2026-08-15
---

# Phase 4 Plan 01: Diary Schema Evolution Summary

**Added `awaiting_input`/`local_date`/`diary_id` to `diary_drafts` and `draft_id` to `diary`, generated and applied the reviewed migration (0007) against the live Supabase database.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-15T00:12:00+05:00 (approx, worktree setup)
- **Completed:** 2026-08-15 (checkpoint approved by owner)
- **Tasks:** 2 (1 auto, 1 blocking checkpoint)
- **Files modified:** 5 (2 schema files, 1 new migration SQL, 2 drizzle meta files)

## Accomplishments
- `diary_drafts` now carries the three columns Phase 4's correction/confirm machinery needs: `awaiting_input` (D-04, free-text routing gate), `local_date` (D-07, frozen calendar day), `diary_id` (D-06, back-link on confirm)
- `diary` now carries `draft_id NOT NULL` (D-06, forward-link to the draft that produced it)
- Rewrote `diary.ts`'s stale top doc comment (it claimed Phase 4 would add per-component rows — D-06 rejected that; the comment now states totals stay denormalised and points at `draft_id`)
- Generated migration 0007 offline, reviewed the SQL by hand, and the owner applied it with `npm run db:migrate` against the live database — confirmed independently by the orchestrator via a migration-journal count (7→8) and a direct `information_schema` query on all four new columns

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the Phase 4 columns to diary_drafts and diary** - `72301c6` (feat)
2. **Task 2: Generate, review and apply the migration** - `91e5a71` (chore, generation half) + owner-run `npm run db:migrate` (apply half, not a commit in this repo)

**Plan metadata:** (this commit)

_Note: Task 2 is a `checkpoint:human-verify` task — the DB-apply step is necessarily performed by the owner, not committed by the executor._

## Files Created/Modified
- `src/db/schema/diary-drafts.ts` - Added `DraftAwaitingInput` interface + `awaitingInput`, `localDate`, `diaryId` columns, each with a decision-referencing doc comment
- `src/db/schema/diary.ts` - Added `draftId` (NOT NULL FK to `diaryDrafts.id`), rewrote the file's top doc comment to drop the stale "per-component rows" claim
- `drizzle/0007_whole_stranger.sql` - Generated migration: 4 `ADD COLUMN` + 2 FK constraint statements, no `DROP`/`TRUNCATE`
- `drizzle/meta/0007_snapshot.json`, `drizzle/meta/_journal.json` - drizzle-kit's own bookkeeping for the new migration

## Decisions Made
- `diary_drafts.local_date` is nullable, not `notNull()` — pre-migration rows (written by Phase 3) have no day to honestly backfill; a `NOT NULL` column would force inventing one. Phase 4's write path always sets it going forward; plan 08's `confirm()` must treat `local_date IS NULL` as a pre-Phase-4 leftover and refuse it with the same copy a stale (D-11, 24h-expired) draft gets.
- `diary.draft_id` is `NOT NULL` — `diary` only ever gets a row through confirmation, never independently, so there's no legitimate row without a draft.
- The plan's suggested fallback for the `diary`↔`diary_drafts` circular FK reference (declare one side as a plain column plus an explicit `foreignKey(...)` in the table's `extras` array) still triggered the same `TS7022` circular-type-inference error, because the `foreignKey()` call still requires a top-level cross-file import — the module-graph cycle, not the choice between `.references()` and `foreignKey()`, was the actual cause. Used drizzle-orm's documented `AnyPgColumn`-typed lazy-reference pattern (`references((): AnyPgColumn => otherTable.id)`) on **both** sides instead, which breaks TypeScript's inference cycle while producing the identical SQL FK constraints (confirmed in the generated migration).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Circular-FK TypeScript inference error required a different fix than the plan's suggested fallback**
- **Found during:** Task 1
- **Issue:** `diary-drafts.ts` importing `diary` (for `diaryId`) and `diary.ts` importing `diaryDrafts` (for `draftId`) is a genuine module-level circular import; TypeScript reported `TS7022: implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer` on both `pgTable(...)` calls. The plan's suggested fallback (plain `integer('draft_id').notNull()` + a `foreignKey(...)` entry in `diary.ts`'s extras array) still imports `diaryDrafts` at module top level and hit the identical error.
- **Fix:** Used drizzle-orm's own documented circular-reference pattern instead: `.references((): AnyPgColumn => diaryDrafts.id)` (and the mirror on `diary-drafts.ts`'s `diaryId`), importing `type AnyPgColumn` from `drizzle-orm/pg-core`. The explicit return-type annotation on the lazy closure is what breaks TypeScript's inference cycle; the generated SQL constraints are unaffected (confirmed byte-for-byte against the plan's expected shape in `drizzle/0007_whole_stranger.sql`).
- **Files modified:** `src/db/schema/diary.ts`, `src/db/schema/diary-drafts.ts`
- **Verification:** `npx tsc --noEmit` exits 0; full test suite (510 tests at the time) passes; generated migration SQL matches the plan's exact expected column/constraint list.
- **Committed in:** `72301c6`

**2. [Rule 3 - Blocking] `drizzle-kit generate` requires a syntactically valid `DATABASE_URL` even though it never connects**
- **Found during:** Task 2
- **Issue:** `drizzle.config.ts` calls `loadEnv()` (this project's fail-fast env loader) before invoking `drizzle-kit generate`, which errored with "не заданы переменные окружения" because no `.env` file exists in a fresh worktree checkout.
- **Fix:** Created a throwaway `.env` with placeholder values (fake `DATABASE_URL`/`OPENAI_API_KEY`/`TELEGRAM_BOT_TOKEN`) solely so `loadEnv()` would pass its presence check; `drizzle-kit generate` is confirmed offline (it diffs the TypeScript schema against committed migration snapshots and never opens a DB connection — verified by successful generation despite the fake, unreachable `DATABASE_URL`). Deleted the file immediately after generating the SQL. `.env` is gitignored (`.gitignore` lines 4-5) so nothing was ever at risk of being committed, and the owner's real `.env`/`DATABASE_URL` is what `npm run db:migrate` used when they applied it.
- **Files modified:** none tracked (temporary, gitignored `.env`, created and deleted within this session)
- **Verification:** `npm run db:generate` produced the expected SQL; the owner's later `npm run db:migrate` (against their real `.env`) applied it successfully.
- **Committed in:** N/A (no tracked-file change)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were required to complete the plan as specified; neither changed the plan's intended schema shape or migration content. No scope creep.

## Issues Encountered

**`npm run verify-schema` does not check any Phase 4 columns.** Flagging this explicitly per the orchestrator's request during checkpoint resolution: `scripts/verify-schema.ts` is a Phase 3 script with a fixed, hardcoded check list, so its "SCHEMA OK" / exit-0 result during this plan's checkpoint was **not** evidence that the four new columns (`awaiting_input`, `local_date`, `diary_id`, `draft_id`) actually landed — it would have passed identically even if migration 0007 had failed silently or never run. The real signal that confirmed the migration applied was (a) the `drizzle.__drizzle_migrations` journal count going from 7 → 8, and (b) a direct `information_schema.columns` query the orchestrator ran against the live database, confirming all four columns exist with the intended types and nullability. **Recommendation for a later Phase 4 plan:** extend `scripts/verify-schema.ts`'s check list to include these four columns (and any further Phase 4 schema additions), so `verify-schema` regains its intended role as a trustworthy single source of truth for "did my migration actually apply," rather than only covering the tables/columns that existed as of Phase 3.

## User Setup Required

None - no external service configuration required beyond the migration the owner already applied (`npm run db:migrate`, confirmed successful).

## Next Phase Readiness

- `diary_drafts` and `diary` now have every column plans 02-08 of this phase need to read/write (awaiting-input gating, frozen local date, the two-way draft↔diary link) — no further schema changes are anticipated for the rest of Phase 4.
- The `verify-schema` gap above should be closed by whichever later plan next touches `scripts/verify-schema.ts`, so future migrations in this phase get real automated confirmation instead of relying on manual `information_schema` checks.

---
*Phase: 04-confirm-correct-diary-persistence*
*Completed: 2026-08-15*
