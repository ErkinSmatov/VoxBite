---
status: partial
phase: 02-bot-skeleton-onboarding
source: [02-VERIFICATION.md]
started: 2026-08-12T11:20:00Z
updated: 2026-08-12T11:20:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live round-trip against current code (commit 0c3a72d)

Run `/start` on the real bot, complete all 7 questions (sex, age, height,
weight, activity, goal, rate if applicable, timezone) with a mix of button
taps and typed numbers, confirm targets, then run `/start` again.

expected: Onboarding completes; targets + disclaimer shown before
confirmation; second `/start` shows stored targets + disclaimer with a
"redo" button; no crash and no silent hang.

why_human: The owner's earlier walkthrough sign-off was a single blanket
"Все прошло без ошибок" with no per-step transcript, and it predates five
commits — the three code-review blockers (CR-01 error surfacing, CR-02 stale
callback guard, CR-03 cancel/timeout) and the WR-02 disclaimer gap were all
found and fixed afterwards. The checklist therefore attests to a superseded
code state. Code-level evidence for all four success criteria is strong, but
no live run has been recorded against the current commit.

result: [pending]

### 2. Cancel path (new behaviour, never manually exercised)

Start onboarding, then send the cancel keyword mid-questionnaire.

expected: The conversation exits, the bot acknowledges in Russian, and a
subsequent `/start` begins cleanly from the first question rather than
resuming the abandoned one.

why_human: Added by the CR-03 fix after the original walkthrough. Unit tests
cover it, but it has never been exercised against a live Telegram client.

result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
