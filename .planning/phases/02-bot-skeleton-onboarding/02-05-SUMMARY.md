---
phase: 02-bot-skeleton-onboarding
plan: 05
subsystem: onboarding
tags: [grammy, grammyjs-conversations, telegram, vitest, tdd, russian-copy]

# Dependency graph
requires:
  - phase: 02-bot-skeleton-onboarding
    provides: "Plan 02 (pure onboarding logic: parse-fields, options, rate-presets, assemble-profile, onboarding-copy — all reused verbatim), Plan 04 (BotContext, Db, createBot composition root, storage adapter)"
provides:
  - "buildOptionKeyboard/buildRateKeyboard/buildConfirmKeyboard — grammY InlineKeyboard builders driven exclusively by Plan 02's option lists"
  - "saveOnboardedUser — idempotent users upsert (onConflictDoUpdate on telegramId) persisting the domain-clamped rate, not the raw request"
  - "onboardingConversation / ONBOARDING_CONVERSATION_ID — the complete seven-step @grammyjs/conversations v2 flow, not yet registered on the bot"
affects: ["02-06 (registers this conversation on /start)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "InlineKeyboard already starts a fresh empty row after each .row() call, so builders must only call .row() BETWEEN buttons (never after the last one), or an empty trailing inline_keyboard row is produced"
    - "Filtered wait calls (conversation.waitFor with an `otherwise` callback) loop internally until a matching update arrives — that single mechanism handles both 'stray text during a button step' and 'no attempt limit on invalid numeric input' with no manual retry counter"
    - "conversation.external() wraps both the (pure, defensive) domain calculation and the (real) database write — RESEARCH.md Pattern 2's 'is this deterministic AND side-effect-free' bar, not 'does it touch a database'"
    - "изменить (restart) implemented as a plain outer while(true) loop around the whole question sequence — the installed @grammyjs/conversations v2 API exposes no reenter() method (confirmed against conversation.d.ts), matching 02-RESEARCH.md Assumption A3's documented fallback"

key-files:
  created:
    - src/bot/keyboards/onboarding-keyboards.ts
    - src/bot/keyboards/onboarding-keyboards.test.ts
    - src/bot/onboarding/save-user.ts
    - src/bot/onboarding/save-user.test.ts
    - src/bot/conversations/onboarding.ts
  modified: []

key-decisions:
  - "buildOptionKeyboard/buildRateKeyboard only call kb.row() between buttons, never after the final one — grammY's InlineKeyboard.row() unconditionally appends a fresh empty array for future buttons, so calling it unconditionally after every item (including the last) left a trailing empty row in inline_keyboard; discovered via the round-trip test asserting exact row counts, fixed before commit, not a deviation from the plan's behavior spec"
  - "Both askOption/askRate (button steps) and askNumber (text steps) pass `otherwise` to conversation.waitFor(...) so a mismatched-type update (text during a button step, or vice versa) re-sends the current question automatically, using the plugin's own filtered-wait retry loop rather than a hand-rolled counter — this is what the plan's 'if a text message arrives during a button step, re-send the question' rule turned into in code"
  - "onboardingConversation takes db as a third plain parameter (per the plan's own <interfaces> signature), not read from ctx — Plan 06 is expected to close over db when registering via createConversation((conversation, ctx) => onboardingConversation(conversation, ctx, db), ONBOARDING_CONVERSATION_ID), matching src/bot/bot.ts's existing BotDeps-injection style rather than smuggling db through context"

patterns-established:
  - "src/bot/keyboards/onboarding-keyboards.ts is the only file in the phase that constructs Telegram markup, and it renders exclusively from src/bot/onboarding/options.ts and rate-presets.ts — no builder invents a label, value, or callback_data encoding of its own"

requirements-completed: [ONBOARD-01, ONBOARD-02, ONBOARD-05, ONBOARD-06]

# Metrics
duration: ~25min
completed: 2026-08-11
---

# Phase 02 Plan 05: Onboarding Conversation Summary

**The complete seven-step onboarding conversation (`@grammyjs/conversations` v2), its inline keyboards, and an idempotent `users` upsert — orchestration only, delegating every parse/decode/calculation/copy call to Plan 02's pure modules, not yet registered on the bot**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-11T22:34:00+05:00 (approx)
- **Completed:** 2026-08-11T22:39:30+05:00 (approx)
- **Tasks:** 3 (Task 1 TDD, Task 2 TDD, Task 3 auto)
- **Files modified:** 5 created, 0 modified

## Accomplishments

- `buildOptionKeyboard`/`buildRateKeyboard`/`buildConfirmKeyboard` render exclusively from Plan 02's option lists and `RATE_PRESETS_KG_PER_MONTH`; a loop-based round-trip test asserts every rendered `callback_data` decodes back to the exact option/rate it was built from, for all four option lists plus the rate presets, so rendering and decoding cannot silently drift apart (T-02-16, T-02-17)
- `saveOnboardedUser` issues exactly one `insert().onConflictDoUpdate()` targeting `users.telegramId`, persists `targets.rateKgPerMonth` (the domain-clamped value) rather than the user's raw request, nulls the rate for `goal: maintain`, rounds every macro/calorie column to an integer, rejects a non-positive-safe-integer `telegramId` before any DB call, and never calls `console.*` — verified by 8 hermetic tests against a hand-written fake `db` (no real connection)
- `onboardingConversation` walks all seven fields (sex, age, height, weight, activity, goal, rate-when-relevant, timezone) via two small orchestration helpers (`askOption`/`askRate` for button steps, `askNumber` for text steps), both of which use `conversation.waitFor(..., { otherwise })` so a mismatched update type re-sends the current question and a decodable-but-unknown callback value is silently re-asked rather than written into the answers object
- The confirmation screen is produced solely by `targetsWithDisclaimerMessage(targets)` (ONBOARD-06's disclaimer is structurally part of that string, never composed separately) and both `calculateNutritionTargets` and `saveOnboardedUser` are called only inside `conversation.external(...)` — exactly 2 `conversation.external` call sites, verified by the plan's automated grep gate
- "Изменить" restarts the whole seven-question sequence via a plain outer `while (true)` loop and writes nothing to the database; "Всё верно" performs the one `conversation.external`-wrapped upsert and returns

## Task Commits

Tasks 1 and 2 followed RED -> GREEN TDD; Task 3 was a single auto commit per the plan's `type="auto"` (no `tdd="true"`):

1. **Task 1: Inline keyboards driven by the Plan 02 option lists**
   - `c1624e0` test(02-05): add failing test for onboarding inline keyboards
   - `db1b252` feat(02-05): implement onboarding inline keyboards driven by option lists
2. **Task 2: Idempotent persistence of the completed profile and targets**
   - `c2c5e69` test(02-05): add failing test for idempotent onboarding user persistence
   - `0c08041` feat(02-05): implement idempotent onboarded user persistence
3. **Task 3: The seven-step onboarding conversation**
   - `7efe851` feat(02-05): implement the seven-step onboarding conversation

_No refactor commits needed on either TDD task, beyond the trailing-empty-row fix folded into Task 1's GREEN commit before it was first committed (see Deviations)._

## Files Created/Modified

- `src/bot/keyboards/onboarding-keyboards.ts` - `buildOptionKeyboard`, `buildRateKeyboard`, `buildConfirmKeyboard`, `CONFIRM_CALLBACK`, `RESTART_CALLBACK`
- `src/bot/keyboards/onboarding-keyboards.test.ts` - round-trip decode tests across all four option lists + rate presets, row-count/perRow tests, confirm-keyboard label/callback tests
- `src/bot/onboarding/save-user.ts` - `saveOnboardedUser(db, input)`, `SaveOnboardedUserInput`
- `src/bot/onboarding/save-user.test.ts` - 8 cases against a hand-written fake `db`, no real connection
- `src/bot/conversations/onboarding.ts` - `ONBOARDING_CONVERSATION_ID`, `onboardingConversation(conversation, ctx, db)`, plus three private orchestration helpers (`askOption`, `askRate`, `askNumber`)

## `@grammyjs/conversations` v2 signatures used (quoted from the installed `.d.ts`)

From `node_modules/@grammyjs/conversations/out/conversation.d.ts`:

```ts
waitFor<Q extends FilterQuery>(query: Q | Q[], opts?: OtherwiseOptions<C>): AndPromise<Filter<C, Q>>;
external<R, I = any>(op: ExternalOp<OC, R, I>["task"] | ExternalOp<OC, R, I>): Promise<R>;
```

`OtherwiseOptions<C>` (same file) extends `AndOtherwiseOptions<C>`, which carries `otherwise?(ctx: C): unknown | Promise<unknown>` — the mechanism used throughout for "re-send the question and keep waiting" on a mismatched update type.

`createConversation` (`node_modules/@grammyjs/conversations/out/plugin.d.ts:565`):

```ts
export declare function createConversation<OC extends Context, C extends Context>(
  builder: ConversationBuilder<OC, C>,
  options?: string | ConversationConfig<OC, C>,
): MiddlewareFn<ConversationFlavor<OC>>;
```

This confirms Plan 06's registration shape (`createConversation(builder, ONBOARDING_CONVERSATION_ID)`) and, combined with `bot.ts`'s existing `conversations({ storage: { type: 'key', adapter: ... } })` setup, needs no change to this plan's exported function signature.

## Restart branch implementation (изменить) — why an outer loop, not `reenter()`

`Conversation` (`conversation.d.ts`) exposes `wait`, `waitUntil`, `waitFor`, `waitForHears`, `waitForCommand`, `waitForReaction`, `waitForCallbackQuery`, `waitFrom`, `waitForReplyTo`, `skip`, `halt`, `checkpoint`, `rewind`, `external`, `now`, `random`, `log`, `error`, `menu`, `form` — no `reenter()` method exists anywhere in the class. This confirms 02-RESEARCH.md Assumption A3's fallback branch directly (not the `conversation.reenter?.()` optional-chained guess in the RESEARCH.md code sketch, which would have been a silent no-op at runtime since the method is entirely absent from the type, not merely optional). The implementation wraps the entire seven-question sequence, the targets calculation, and the confirm/restart decision in a single `for (;;)` loop inside `onboardingConversation` itself; a `return` after a successful save exits the loop and the function. This needed zero plugin API support and does not recurse into the exported conversation function, per the plan's explicit prohibition.

## Where the installed API differed from 02-RESEARCH.md's sketch

- **`reenter()` does not exist** (see above) — RESEARCH.md's own code sketch already flagged this as uncertain (`conversation.reenter?.()`) and named the outer-loop fallback as equally valid; this plan took that fallback directly rather than discovering the gap at implementation time.
- No other divergence: `waitFor`'s signature, `external`'s signature, and the `otherwise` option on filtered wait calls all matched RESEARCH.md's Pattern 1/2 sketches exactly.

## Decisions Made

**1. `InlineKeyboard.row()` must only be called between buttons, never after the last one**

- **Context:** `InlineKeyboard`'s constructor already starts with one empty pending row; `.row()` pushes the currently-building row onto `inline_keyboard` and starts a new empty one for whatever comes next. Calling `.row()` unconditionally after every button (as RESEARCH.md's own `buildRateKeyboard` sketch does with `kb.text(...).row()` in a bare loop) leaves one empty trailing array in `inline_keyboard` after the last button.
- **Found during:** Task 1's own RED->GREEN cycle — the `defaults to one option per row` test asserted `kb.inline_keyboard` has exactly `SEX_OPTIONS.length` rows and caught a length-3-instead-of-2 mismatch before any commit.
- **Fix:** Both `buildOptionKeyboard` and `buildRateKeyboard` now check `index < length - 1` before calling `.row()`. This is Rule 1 (bug fix caught by the task's own test, fixed inline before the GREEN commit) — not a deviation from the plan's behavioral spec, since the spec only constrains what `.inline_keyboard` must decode to and how many buttons it renders, both of which are unaffected by the empty trailing row; the fix is a strict improvement in what gets sent to Telegram.
- **Files modified:** `src/bot/keyboards/onboarding-keyboards.ts`
- **Commit:** `db1b252` (part of Task 1's single GREEN commit — the bug was caught and fixed before any commit was made, so there is no separate fix commit)

## Deviations from Plan

None beyond the row-count fix documented above (a Rule 1 bug fix, folded into the task's own first GREEN commit rather than requiring a follow-up commit) — all three tasks' `<behavior>`/`<action>` specs and every `<acceptance_criteria>` line were implemented as written.

## Known Stubs

None — every exported function is fully implemented. `onboardingConversation` is intentionally not yet registered on the bot; that is Plan 06's explicit job per this plan's own `<objective>` ("Output: a complete conversation function, not yet registered on the bot").

## Threat Flags

None — all four `<threat_model>` entries (T-02-16 through T-02-19, plus T-02-20's no-logging rule) are the exact surfaces implemented and covered by this plan's automated checks; no new surface was introduced beyond what the plan anticipated.

## Issues Encountered

None blocking beyond the `InlineKeyboard.row()` trailing-empty-row discovery documented above, which was caught and fixed within Task 1's own TDD cycle.

## User Setup Required

None — no new environment variables, dependencies, or dashboard configuration. This plan builds on `@grammyjs/conversations` already installed in Plan 01/04.

## Next Phase Readiness

- Plan 06 can register this conversation directly: `bot.use(createConversation((conversation, ctx) => onboardingConversation(conversation, ctx, db), ONBOARDING_CONVERSATION_ID))`, added after the existing `conversations()` middleware in `src/bot/bot.ts`, then wire `bot.command('start', ...)` to `ctx.conversation.enter(ONBOARDING_CONVERSATION_ID)`.
- No runtime bot process was started or left running during this plan's execution — all verification was via `npx vitest run` and `npx tsc --noEmit`.
- `npm test` (whole repo, 298 tests across 21 files) and `npx tsc --noEmit` both pass.

## Self-Check: PASSED

All 5 created files verified present on disk (`src/bot/keyboards/onboarding-keyboards.ts`, `src/bot/keyboards/onboarding-keyboards.test.ts`, `src/bot/onboarding/save-user.ts`, `src/bot/onboarding/save-user.test.ts`, `src/bot/conversations/onboarding.ts`); all 5 task commit hashes (`c1624e0`, `db1b252`, `c2c5e69`, `0c08041`, `7efe851`) verified present in `git log --oneline --all`.

---
*Phase: 02-bot-skeleton-onboarding*
*Completed: 2026-08-11*
