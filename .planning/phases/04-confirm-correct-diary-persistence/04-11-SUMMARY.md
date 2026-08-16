---
phase: 04-confirm-correct-diary-persistence
plan: 11
subsystem: docs
tags: [manual-verification, uat, checklist]

# Dependency graph
requires:
  - phase: 04-confirm-correct-diary-persistence
    plan: 10
    provides: the fully wired bot — every code plan of the phase merged and green
provides:
  - "docs/phase-04-manual-checklist.md: the owner-executable 12-scenario walkthrough"
  - "04-UAT.md: the recorded walkthrough results across two rounds"
affects: []

tech-stack:
  added: []
  patterns:
    - "The manual checklist is written for an owner with no backend experience: every step names the exact command, the directory to run it in, the table and column to inspect in Drizzle Studio, and quotes the expected Russian string verbatim from correction-copy.ts rather than paraphrasing it"

key-files:
  created:
    - docs/phase-04-manual-checklist.md

key-decisions:
  - "Scenario 12 (a card older than 24 hours) is recorded as skipped, not passed. No such card could exist on the implementation day. The expiry rule is covered by unit tests; only its on-device presentation is unverified, and the checklist explicitly permits recording this honestly rather than fabricating a pass."
  - "The round-1 blocker was NOT patched inside this checkpoint. Per this plan's own objective, a defect found during the walkthrough is closed by a follow-up gap-closure plan (04-12) so the phase boundary stays intact and the fix carries its own regression test."

requirements-completed: []
requirements-verified: [CORRECT-01, CORRECT-02, CORRECT-03, CORRECT-04, CORRECT-05, CORRECT-06, CORRECT-07, CORRECT-08, CALC-02, DIARY-01]

# Metrics
duration: two rounds across one day
completed: 2026-08-15
---

# Phase 4 Plan 11: Manual Device Walkthrough Summary

**The owner-executable checklist plus the on-device verification it exists to drive — the step
that caught what 687 passing tests could not: a fully built, fully tested correction UI that was
unreachable from the product's only entry point.**

## Accomplishments

- `docs/phase-04-manual-checklist.md` — 345 lines: a preflight section (`npm test`,
  `npm run typecheck`, `npm run verify-schema`, `npm run bot`) and 12 numbered scenarios, each
  stating what to do, what should be observed (quoting `correctionCopy` verbatim), and what a
  different observation means. Written for a reader who does not know the codebase.
- Round 1 walkthrough — halted at scenario 1 with a blocker. Recorded in `04-UAT.md` with the
  owner's verbatim report and a root-cause diagnosis produced by direct code inspection.
- Round 2 walkthrough (after gap-closure plan 04-12) — owner signed off. 11 of 12 scenarios
  passed; scenario 12 skipped as untestable on the day.

## What this plan verified

Both manual-only verifications named in `04-VALIDATION.md` are now discharged:

- **CORRECT-07 / D-04** — a correction in progress survives `Ctrl+C` and a fresh `npm run bot`.
  This is the one that proves the draft's waiting state lives in the database rather than in
  process memory; no unit test can demonstrate it, because killing the process is the whole point.
- **CALC-02 / D-09** — a component whose USDA record carries no sugar reads «нет данных» rather
  than `0`, on the preview line and on the saved entry alike. "No data" and "zero sugar" are
  different claims, and for someone tracking sugar the difference is the product.

## Issues Encountered

**The round-1 blocker (resolved by 04-12).** The voice pipeline still rendered the Phase 3
read-only card and attached no keyboard, so no message ever carried a `crc:` callback button and
the entire Phase 4 correction UI was unreachable. It was a seam defect — no plan in 04-01..04-11
owned "replace the initial card render" — and simultaneously a coverage gap, since 04-10's
tripwires checked handler registration ORDER but nothing asserted the delivered message carried a
keyboard. Full diagnosis and resolution in `04-UAT.md`.

The lesson is structural, not incidental: a green suite proves the parts work, not that they are
connected to the user. Plan 04-12's `entry-point-reachability.test.ts` is the artifact that now
holds that line.

## Observations routed elsewhere

Two things surfaced in round 1 that belong to Phase 3, recorded in `04-UAT.md` and deliberately
kept out of the 04-12 gap closure: implausible LLM gram estimates («тост — 2 г») and
«⚠️ совпадение слабое» appearing on 5 of 6 components. The correction UI lets a user fix a bad
match; it does not make the matches good. Both bear on the product's core value and deserve their
own look.
