---
phase: 04-confirm-correct-diary-persistence
reviewed: 2026-08-16T13:26:02Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - drizzle/0007_whole_stranger.sql
  - drizzle/meta/0007_snapshot.json
  - drizzle/meta/_journal.json
  - src/application/confirm-meal.ts
  - src/application/corrections.ts
  - src/application/draft-store.ts
  - src/application/limits.ts
  - src/application/local-date.ts
  - src/application/types.ts
  - src/application/voice-pipeline.ts
  - src/bot/bot.ts
  - src/bot/correction-wiring.ts
  - src/bot/formatting/correction-card.ts
  - src/bot/formatting/correction-copy.ts
  - src/bot/formatting/result-card.ts (deletion, intended per 04-12)
  - src/bot/handlers/correction.ts
  - src/bot/handlers/meal.ts
  - src/bot/keyboards/correction-keyboards.ts
  - src/bot/pipeline-wiring.ts
  - src/bot/telegram/draft-card-renderer.ts
  - src/bot/telegram/message-editor.ts
  - src/bot/telegram/safe-edit.ts
  - src/db/schema/diary-drafts.ts
  - src/db/schema/diary.ts
  - src/domain/nutrition/calculate-total.ts
  - src/domain/nutrition/index.ts
findings:
  critical: 2
  warning: 2
  info: 1
  total: 5
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-08-16T13:26:02Z
**Depth:** standard
**Files Reviewed:** 33 (test files read for cross-reference, not separately findings-eligible)
**Status:** issues_found

## Summary

The IDOR scoping (`draft-store.ts`'s user-scoped reads/writes), the compare-and-swap claims on confirm/abandon, the nutrient math (`calculateTotal`, never coalesced to `0`), the D-07 frozen-local-date discipline, and the D-10 "cannot confirm with an unmatched component" gate are all implemented correctly and match their documentation. `tsc --noEmit` is clean.

However, tracing the "editing a saved (confirmed) diary entry" path end-to-end (D-05/CORRECT-08) surfaces a real, provable money-leak and correctness bug: the D-04 text gate (`findAwaitingDraft`) only ever looks at `status = 'draft'` rows, but the `➕ Добавить` / `⌨ Ввести граммы` buttons can be tapped on an already-**confirmed** draft (reached via `✎ Поправить`), which sets `awaiting_input` on a `status = 'confirmed'` row. The text gate will never find that row, so the user's typed correction text (a gram amount or an added ingredient name) silently falls through into the normal paid meal pipeline — exactly the failure class `meal.ts`'s own module comment calls "the single most expensive and most confusing failure available in Phase 4," except here it hits the one flow (editing a saved entry) that the module comment doesn't discuss. A second, compounding bug sits right behind it: even were the routing fixed, the code path that would consume that text (`handleAwaitingText`) never calls `recomputeSavedEntry`, unlike every button-driven correction — so a text-based edit to a saved entry would leave the persisted `diary` row's totals stale.

There is also a smaller, self-visible gap where editing a saved entry down to zero components writes a diary row with all-null totals, unlike the equivalent guard on the initial confirm.

## Critical Issues

### CR-01: The D-04 text gate never finds a `confirmed` draft's awaiting input, so a typed correction to a saved entry spends money on a bogus new meal analysis instead of applying the correction

**File:** `src/application/draft-store.ts:113-121`
**Issue:** `findAwaitingDraft` is the *only* lookup `src/bot/handlers/meal.ts`'s gate 0.5 (`interceptCorrectionText`) uses to decide "is this plain-text message a correction reply, or a new (paid) meal description." It filters `eq(diaryDrafts.status, 'draft')`:

```ts
export async function findAwaitingDraft(db: Db, userId: number): Promise<PersistedDraft | null> {
  const rows = await db
    .select(draftColumns)
    .from(diaryDrafts)
    .where(
      and(eq(diaryDrafts.userId, userId), eq(diaryDrafts.status, 'draft'), isNotNull(diaryDrafts.awaitingInput)),
    )
```

But `awaiting_input` is also set on `status = 'confirmed'` rows: `src/bot/handlers/correction.ts`'s `case 'add'` and `case 'sel'`/`case 'gtype'` call `setAwaitingInput` unconditionally, and all of them are reachable on a confirmed draft via `case 'edit'` → `renderLevel1(draft.components)`, which uses the same `buildLevel1Keyboard` (Добавить/Подтвердить buttons) for a confirmed draft as for a fresh one. Concretely:
1. User confirms a meal (`diary_drafts.status` → `'confirmed'`, a `diary` row exists).
2. User taps `✎ Поправить` (`case 'edit'`) → sees the level-1 card with a live `➕ Добавить` button.
3. User taps `➕ Добавить` (`case 'add'`) → `setAwaitingInput(db, draftId, userId, { kind: 'add_component' })` is written on the **confirmed** row.
4. User types an ingredient name, e.g. "сметана 30".
5. `meal.ts`'s text handler calls `interceptCorrectionText` → `createCorrectionTextHandler` → `findAwaitingDraft(db, user.id)` → **returns `null`** because the row's status is `'confirmed'`, not `'draft'`.
6. `meal.ts` proceeds through its normal gate sequence (`claimUpdate` → `findOnboardedUser` → daily cap → ack → `processMeal`), running a full paid LLM decomposition + embedding call on the string "сметана 30" as if it were a brand-new meal — while the original edit-in-progress draft is left stuck with a stale `awaiting_input` that the user's actual reply never reaches.

The exact same routing failure applies to `⌨ Ввести граммы` (`case 'gtype'`/`case 'sel'` on a confirmed draft): a typed gram number for an existing saved entry's component is analysed as a new meal instead of being applied.

No test in `draft-store.test.ts` or `correction.test.ts` exercises `findAwaitingDraft`/the text-gate path against a `status: 'confirmed'` row — every `makeRow`/`makeDraft` fixture used against `findAwaitingDraft` defaults to `'draft'`.

**Fix:** Widen the filter to match `updateDraftComponents`'s own scoping rule (both statuses are editable):
```ts
export async function findAwaitingDraft(db: Db, userId: number): Promise<PersistedDraft | null> {
  const rows = await db
    .select(draftColumns)
    .from(diaryDrafts)
    .where(
      and(
        eq(diaryDrafts.userId, userId),
        or(eq(diaryDrafts.status, 'draft'), eq(diaryDrafts.status, 'confirmed')),
        isNotNull(diaryDrafts.awaitingInput),
      ),
    )
    .orderBy(desc(diaryDrafts.updatedAt))
    .limit(1);
  ...
```
(`or` is already imported in this file.) Add a regression test with `status: 'confirmed'` to `draft-store.test.ts` and an end-to-end test in `correction.test.ts`/`meal.test.ts` asserting a typed reply to a confirmed draft's `add`/`gtype` prompt is intercepted and never reaches `processMeal`.

### CR-02: Even once routing is fixed, text-based corrections to a saved entry never recompute the diary snapshot

**File:** `src/bot/handlers/correction.ts:518-570`
**Issue:** Every *button*-driven correction in this file recomputes the linked `diary` row when the draft is already saved:
```ts
// case 'cand' (line 257-259), case 'gm'/'gp' (line 278-280), case 'rm' (line 310-312)
if (draft.status === 'confirmed') {
  await recomputeSavedEntry(d.db, cb.draftId, user.id);
}
```
`handleAwaitingText` (the function that actually applies a typed grams value or an added component, lines 518-570) has no equivalent call anywhere in either branch (`awaiting.kind === 'typed_grams'` at 518-540, or the `add_component` branch at 542-570). So once CR-01 is fixed and a typed correction to a confirmed draft is correctly routed and applied to `diary_drafts.components`, the linked `diary` row's `kcal`/`proteinG`/`fatG`/`carbsG`/`sugarG`/`description` columns are **not** updated — the user sees the corrected component list on the redrawn card (which recomputes the "≈" preview live from `components` via `formatTotalsBlock`), but the durable diary record silently keeps the pre-edit numbers. This directly violates the module's own stated invariant ("D-03 requires ... the number written into `diary` to come from this SAME function ... Adding a second summation anywhere is the specific failure D-03 forbids" — here the failure is the opposite: a *missing* summation, leaving stale data instead of a duplicate).

**Fix:** Add the same `if (draft.status === 'confirmed') { await recomputeSavedEntry(d.db, draft.id, user.id); }` guard after a successful `applyTypedGrams` (before `renderLevel2` at line 538) and after a successful `addComponent` (before the final `renderLevel1` calls at lines 566-570), mirroring the callback handler's pattern exactly. Add a test asserting `recomputeSavedEntry` is called when `handleAwaitingText` is invoked against a `status: 'confirmed'` draft — the existing test suite (see `correction.test.ts:359-369`) only proves this for the button (`gp`) path, never for the text path.

## Warnings

### WR-01: Editing a saved entry down to zero components has no equivalent to the initial-confirm empty-state guard

**File:** `src/application/confirm-meal.ts:255-296` (`recomputeSavedEntry`)
**Issue:** `confirmMeal` explicitly refuses to create a diary row from an empty component list (`if (draft.components.length === 0) return { ok: false, reason: 'empty' }`, line 176-178) — the module comment calls this "D-12: the empty state can never reach the diary." `recomputeSavedEntry`, the function `src/bot/handlers/correction.ts`'s `case 'rm'` calls unconditionally whenever `draft.status === 'confirmed'` (line 310-312), has no such check: removing the last remaining component of an already-saved entry calls `recomputeSavedEntry` with `draft.components = []`, which happily runs `calculateTotal([])` (all nutrients `null`, per `calculateTotal`'s own correct null-propagation) and `UPDATE diary SET kcal = NULL, ... WHERE id = ...`. The result is a permanently saved diary row with a description but literally no ingredients and no macros — silently, with no distinct copy telling the user this happened (the redrawn card falls through to `renderLevel1`'s `components.length === 0` branch, which shows the generic `emptyState` copy, not something specific to "you just zeroed out a saved entry").
**Fix:** Either (a) give `recomputeSavedEntry` the same `components.length === 0` guard as `confirmMeal` and have the `'rm'` case in `correction.ts` treat that outcome distinctly (e.g. offer add-back-or-delete, matching the D-12 empty-state copy but for a saved entry), or (b) if reaching zero components should delete the diary row outright, call `deleteSavedEntry`-equivalent cleanup instead of writing an all-null row. Either way, a `diary` row with zero backing components should not be reachable without an explicit decision point, the same way `confirmMeal` already requires one.

### WR-02: A narrow race can show "разбор устарел" for a confirm that actually just succeeded

**File:** `src/bot/handlers/correction.ts:359-369` (`case 'confirm'`, `already_confirmed` branch)
**Issue:** `confirmMeal`'s CAS (`claimConfirm`) flips `status` to `'confirmed'` *before* the `diary` INSERT and `linkDiaryRow` complete (`confirm-meal.ts:190-224`). If a second `confirm` tap's `claimConfirm` loses the race in that window, `confirmMeal` returns `already_confirmed`, and the handler re-reads the draft to render the confirmed card — but if that re-read lands between `claimConfirm` succeeding and `linkDiaryRow` completing, `fresh.diaryId` is still `null`, and the handler falls into `editText(correctionCopy.expired, ...)` even though the first tap's confirm is about to succeed normally. This is a genuine but very narrow window (single-process async interleaving between two near-simultaneous taps), and it is self-correcting (the underlying `diary` row does get created, the user can just re-open the message state via any other button or resend), so it does not rise to Critical, but it is a real, provable inconsistency between "what actually happened" and "what the second tapper is told."
**Fix:** Low priority given the narrow window and self-correcting nature; if addressed, consider a short bounded retry (e.g. re-read once more after a tick) before falling back to `expired`, or track a distinct "confirming in progress" state so the second tap gets a more accurate "почти готово, подожди" message instead of "устарел."

## Info

### IN-01: `del` renders the delete-confirmation prompt for a draft that was never actually saved

**File:** `src/bot/handlers/correction.ts:385-390` (`case 'del'`)
**Issue:** Unlike `case 'delno'`/`case 'delyes'`, `case 'del'` does not check `draft.diaryId !== null` before showing `correctionCopy.deletePrompt` with `buildDeleteConfirmKeyboard`. In practice `del` is only offered on `buildConfirmedKeyboard` (a confirmed draft), so this is unreachable through the normal UI, but a hand-crafted `crc:<own_draft_id>:del` against one's own never-confirmed draft shows a "Удалить запись? Это навсегда." prompt for something that was never saved; tapping "Да, удалить" then correctly resolves to `not_saved` → `expired` copy via `deleteSavedEntry`, so there's no data-integrity impact, just a slightly misleading intermediate screen reachable only by crafting a callback.
**Fix:** Optional — guard `case 'del'` the same way `case 'delno'` already does (`draft.diaryId === null → expired`), for consistency, not correctness.

---

_Reviewed: 2026-08-16T13:26:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
