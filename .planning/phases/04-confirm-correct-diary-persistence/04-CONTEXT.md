# Phase 4: Confirm/correct + diary persistence - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning

<domain>
## Phase Boundary

The read-only card Phase 3 leaves on screen becomes **interactive**: the user
reviews the decomposed meal, swaps a component's FDC match for one of the
other 2 candidates, adjusts grams, removes a component, adds a missing one by
text — and confirms. On confirmation the final calories/protein/fat/carbs/
sugar are computed **purely arithmetically** (grams × FDC per-100 g, no LLM)
and written to the user's diary for the correct day in their timezone. The
same correction mechanics also work on an already-saved entry, and a saved
entry can be deleted.

Covers CORRECT-01..08, CALC-01, CALC-02, DIARY-01.

**Explicitly NOT in this phase:** the diary *views* — the day list with
totals against targets and the weekly summary (DIARY-02/03 → Phase 5);
payments and subscription limits; reminders; deployment/webhook; any change
to STT, decomposition or FDC indexing.

The phase starts from what Phase 3 produced: a `diary_drafts` row (D-19 of
Phase 3) and a Telegram message the bot owns and edits in place (D-13 of
Phase 3). It ends with rows in `diary` that are trustworthy enough to build
Phase 5's views on top of.

</domain>

<decisions>
## Implementation Decisions

### Card shape and keyboards

- **D-01: Two-level card, not one flat keyboard.** Level 1 is the meal:
  the component list as text, one button per component (e.g. `1. Говядина
  120 г`), plus `➕ Добавить` and `✅ Подтвердить`. Tapping a component
  redraws **the same message** into level 2 — the single-component edit
  screen: its 3 FDC candidates, the gram controls, `✕ Убрать` and `← Назад`.
  Rationale: on a 5-ingredient dish (бешбармак is realistically 4-5) a flat
  card with `▾ −10 +10 ✕` per component is 20 buttons and half a phone
  screen. With two levels the button count is bounded regardless of how many
  ingredients the LLM produced. A three-level variant (`Подтвердить` /
  `Поправить` → pick component → edit) was considered and rejected: it buys a
  cleaner "everything is right" screen at the cost of an extra tap on every
  correction, and correction is the point of this phase.

- **D-02: FDC candidates are rendered as numbered text with `1 / 2 / 3`
  buttons**, not as three wide buttons carrying the description. The FDC
  description is shown verbatim in the message body with a mark on the
  currently chosen one. Rationale: the distinguishing information in an FDC
  description sits at the END of the string ("Chicken, broilers or fryers,
  breast, meat only, **raw**" vs "... **cooked, roasted**") and that
  raw-vs-cooked signal is the user's only way to tell candidates apart
  (see the doc comment on `FdcCandidate.description`). Telegram truncates
  long button labels with an ellipsis — exactly where the meaning is.

- **D-03: The card shows a live КБЖУ preview before confirmation. This
  REVISES Phase 3's D-20.** A single line under the component list —
  `≈ 620 ккал · Б 45 · Ж 28 · У 44` — recomputed on every correction, always
  carrying the `≈` sign and a "пока не сохранено" marker. Rationale: D-20 was
  correct for Phase 3, where the card was read-only and numbers could only
  read as premature results. In Phase 4 the user is actively turning grams
  and swapping candidates; without numbers those corrections are made blind,
  and the entire point of correcting is to land on the right numbers.
  **Hard constraint:** the preview must be produced by the *same* pure
  function as the final CALC-01 calculation — never a second, "approximate"
  implementation. This mirrors the `isWeakMatch` precedent in
  `src/application/types.ts`, where one exported function guarantees the
  pipeline and the formatter can never disagree.

- **D-04: Free-text input is gated by an explicit `awaiting_input` flag on
  the draft row, cleared by timeout or a Cancel button.** Today every text
  message starts a new (paid) meal analysis via the VOICE-04 handler. After
  the user taps `➕ Добавить` or `⌨ Ввести граммы`, the draft row records
  what input is expected and for which component; the next text message from
  that user is routed into the correction instead of the pipeline. The flag
  lives in Postgres, not memory — same rule as everything else in
  `src/application/` (ARCHITECTURE.md Anti-Pattern 4), so it survives a
  restart mid-typing. Telegram's `ForceReply` was rejected: it forces a
  second message (breaking Phase 3's D-13 one-message-edited-in-place) and
  is easy to miss on mobile, silently sending the text to the paid pipeline.

### Confirmation, saving, editing a saved entry

- **D-05: After `✅ Подтвердить` the same message becomes the diary entry.**
  It is redrawn with the final numbers (no `≈`), a line naming the day it was
  saved to, and two buttons: `✎ Поправить` and `🗑 Удалить`. `✎ Поправить`
  reopens the exact same two-level correction screen. CORRECT-08 is therefore
  satisfied by one mechanism, not by a second edit UI — and it is testable in
  this phase without waiting for the Phase 5 diary views.

- **D-06: The draft row stays the working copy; `diary` holds a snapshot of
  the totals.** On confirmation the `diary_drafts` row flips to
  `status = 'confirmed'` and lives on indefinitely; a `diary` row is written
  with the computed totals plus a reference back to the draft. Editing a
  saved entry runs the same correction machinery over the same draft row,
  recomputes, and UPDATEs the `diary` row. Rationale: one correction code
  path for before-save and after-save, and zero new tables. Copying the
  component array into `diary` was rejected (two containers = two code paths
  = two places for the same bug); a normalised `diary_items` table was
  rejected as a migration and a layer serving an analytics feature that does
  not exist in v1.
  **Consequence the planner must handle:** confirmed drafts are durable
  records now, so any draft cleanup (D-11) must never touch them, and the
  `diary_drafts` doc comment claiming Phase 4 "extends" the table should be
  updated to say Phase 4 made it the system of record for meal composition.

- **D-07: The diary day is fixed from the moment of the original message and
  never moves.** `local_date` is derived from the incoming voice/text
  message's timestamp converted into `users.timezone`, frozen on the draft,
  and reused unchanged on confirmation and on every later edit. Rationale:
  dinner dictated at 23:50 and confirmed at 00:05 is yesterday's dinner;
  taking the day at confirmation time would silently corrupt two days'
  totals at once. Editing yesterday's entry today must not migrate it to
  today. A manual "вчера/сегодня" day switcher was considered and deferred —
  it adds buttons and a test case for a scenario the frozen-day rule already
  handles correctly in the common case.

- **D-08: Deleting a saved entry is a confirmed hard delete.** `🗑 Удалить`
  asks `Удалить запись? Да / Нет`; on Yes the `diary` row is DELETEd and the
  linked draft is marked `abandoned`. Rationale: this is health data —
  "delete" must mean delete (TECH_SPEC §10). Soft-delete was rejected because
  every future diary query would have to remember the filter, and forgetting
  it once makes the totals lie. Deleting without confirmation was rejected
  because the button lives beside `✎ Поправить` in chat history, where a
  stray tap weeks later would destroy data.

### Honest numbers and degenerate cases

- **D-09: A partially-known nutrient total is shown as a lower bound with an
  explicit count** — `≥ 12 г (у 1 из 5 нет данных)` — not as a plain sum and
  not as a blanket "нет данных". Applies to **every** nutrient, not just
  sugar, whenever at least one component's FDC record has `null` for it.
  Rationale: TECH_SPEC §5.8 forbids substituting 0 or a guess; a plain `12 г`
  is exactly the false comfort it warns about, while suppressing the whole
  total throws away four honest USDA measurements — and since Foundation
  Foods frequently lacks sugar, suppression would make the sugar feature
  useless in practice. If *no* component has a value, the total is
  `нет данных` with no number.

- **D-10: Confirmation is blocked while any component has no FDC match at
  all.** When `chosenFdcId` is `null` (no candidates were returned),
  `✅ Подтвердить` refuses with a Russian message naming the offending
  component and offering the two ways out — remove it, or describe it
  differently. Rationale: saving a meal in which part of the food silently
  contributes zero calories is worse than a blocked button; it produces a
  diary the user cannot trust, which is a direct hit on the project's Core
  Value. Note this is narrower than Phase 3's D-21: a *weak* match still
  confirms freely (it is flagged, and the picker is right there) — only a
  *missing* match blocks.

- **D-11: A draft expires 24 hours after it was created.** Past that, its
  buttons stop working: the bot answers "этот разбор устарел, отправь
  сообщение заново" and removes the keyboard. Rationale: the card sits in
  chat history forever, and a stray tap three days later would otherwise log
  a meal the user has long forgotten. This pairs with D-07 — a stale
  confirmation would land in a day the user is no longer thinking about.
  Confirmed drafts are exempt (they are diary records, per D-06); background
  deletion of abandoned rows was deliberately not taken, since it needs a
  scheduler this phase does not otherwise have.

- **D-12: Removing the last component yields an empty state, not an error and
  not an auto-cancel.** The card reads "компонентов не осталось",
  `✅ Подтвердить` disappears, and `➕ Добавить` plus `✕ Отменить разбор`
  (draft → `abandoned`) remain. An empty entry can therefore never reach the
  diary, and the user who deleted one component too many can simply add it
  back instead of losing the whole analysis.

### Claude's Discretion

Not discussed — the planner's call within the constraints above:

- **Gram-adjustment step and typed-gram parsing.** ±10 g is required by
  CORRECT-04; whether to also offer ±50 g (or ±10 % for large portions) is
  open. Parsing of a typed value must tolerate `200`, `200 г`, `200г` and
  reject nonsense with a Russian retry message rather than a crash. Grams
  must never go to zero or negative via the ± buttons.
- **Exact Russian wording and emoji** on every button and message, following
  the established actionable-Russian house style
  (`src/bot/formatting/*-copy.ts`).
- **`callback_data` encoding** for the two-level navigation. Telegram caps it
  at 64 bytes, so it must carry ids/indices, never descriptions. Stale
  callbacks go through the existing `ack()` helper
  (`src/bot/telegram/ack.ts`).
- **Where the added-component text is matched.** CORRECT-06 says it goes
  through the same FDC search — that means the existing `matchIngredient()`
  in `src/domain/fdc-matching/`, with the runtime embedding produced by the
  same `Embedder` at the same model/dimensions the index was built with
  (`text-embedding-3-large` @1536). It must NOT re-run STT or the
  decomposition LLM. Whether an added component's grams are asked for
  separately or parsed from the same string is open.
- **Where `diary.description` comes from** (the transcript is on the draft
  row; a component-name join is also available), and how the meal is labelled
  in the saved card.
- **Schema evolution of `diary_drafts`** — the new columns implied by D-04,
  D-06, D-07 (awaiting-input state, local date, link to the diary row) and
  the `components` jsonb shape now that `chosenFdcId` becomes user-settable.
  Migration workflow is locked by Phase 1: `drizzle-kit generate` + `migrate`,
  `push` is banned, RLS enabled with zero policies on any new table, and the
  owner reviews the SQL before `db:migrate` runs.
- **File layout** under `src/domain/nutrition/` (the CALC-01 function),
  `src/application/` (correction operations over a draft, confirm, edit,
  delete), `src/bot/keyboards/` and `src/bot/formatting/`. The hexagonal rule
  holds: `src/domain/**` and `src/application/**` never import grammY.
- **Test strategy** — the Phase 1-3 pattern: the calculation, the partial-
  total rule (D-09), the correction operations (swap candidate, adjust grams,
  remove, add), the expiry decision (D-11) and the empty-state rule (D-12)
  are pure functions and get Vitest tests against fakes; anything touching
  Telegram or a real API is verified by hand or by a `verify-*` script.
- **Whether to extend `verify-*` scripts** for this phase (the deferred
  `verify-pipeline` idea from Phase 3 is now more relevant, since end-to-end
  accuracy is finally measurable — but it was not requested here).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & scope
- `TECH_SPEC.md` §3.3 — the voice → diary flow this phase completes
- `TECH_SPEC.md` §5.6 — the three levels of correction (candidate picker,
  gram editing, composition editing). Explicitly marked there as "requires
  the owner's approval" — this discussion IS that approval, and D-01..D-04
  supersede §5.6's sketch where they differ
- `TECH_SPEC.md` §5.7 — the exact arithmetic for CALC-01: per component
  `(grams / 100) × per-100g value`, summed; no LLM anywhere on this path
- `TECH_SPEC.md` §5.8 — missing sugar is "нет данных", never 0 and never a
  guess (source of D-09)
- `TECH_SPEC.md` §10 — nutrition data is sensitive health data (source of
  D-08's hard delete)
- `.planning/ROADMAP.md` → "Phase 4" — the five success criteria this phase
  is graded against
- `.planning/REQUIREMENTS.md` — CORRECT-01..08, CALC-01, CALC-02, DIARY-01
- `.planning/PROJECT.md` — Core Value: if the numbers are not trustworthy
  there is no product

### Architecture & stack
- `.planning/research/ARCHITECTURE.md` — Pattern 3 (ports and adapters),
  Pattern 4 + Anti-Pattern 4 (correction/draft state lives in Postgres,
  never in process memory), Internal Boundaries (`bot/` ↔ `application/`)
- `.planning/research/STACK.md` — grammY inline keyboards, Drizzle,
  `@grammyjs/menu` as an option for the picker
- `.planning/research/PITFALLS.md` — implementation traps

### Prior phase decisions
- `.planning/phases/03-voice-pipeline/03-CONTEXT.md` — D-13 (one message
  edited in place; the `message_id` this phase hangs its keyboard on),
  D-18/D-20 (**D-20 is revised here by D-03**), D-19 (the persisted draft),
  D-21 (weak matches are flagged, never dropped — narrowed here by D-10)
- `.planning/phases/01-foundation-data-domain-math/01-CONTEXT.md` — the
  migration workflow (`generate` + `migrate`, `push` banned, RLS), the
  embedding model/dimension invariant
- `.planning/phases/02-bot-skeleton-onboarding/02-CONTEXT.md` — fail-closed
  allowlist ordering, verification style

### Project rules
- `CLAUDE.md` — the owner has no backend experience: setup steps must be
  written out literally; never agree by default — flag risky choices before
  implementing them

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/application/types.ts` — `DraftComponent`, `MealDraft`,
  `isWeakMatch()`, `WEAK_MATCH_SIMILARITY_THRESHOLD`, the `MessageEditor`
  port. This phase extends these types rather than inventing parallel ones;
  `isWeakMatch` is the precedent D-03 points at (one exported rule so two
  call sites can never disagree).
- `src/bot/formatting/result-card.ts` — `buildResultCard()`, the Phase 3
  read-only card. Phase 3 built it so Phase 4 could **add buttons to an
  existing formatter** instead of writing a second one. Keep its two
  invariants: FDC descriptions verbatim, and plain text with no `parse_mode`
  (an FDC description containing `_` or `*` must not break rendering).
- `src/domain/fdc-matching/index.ts` — `matchIngredient()`, the only
  sanctioned entry point for matching. CORRECT-06's added component goes
  through this, not through hand-written pgvector SQL.
- `src/adapters/embeddings/openai-embed.ts` — the `Embedder` port; the added
  component's embedding must use the same model/dimensions as the index.
- `src/bot/telegram/ack.ts` — `ack()`, which already exists precisely for the
  "button tapped a day later" case D-11 formalises.
- `src/application/draft-store.ts` — currently only `saveDraft()`. This phase
  adds the read/update/confirm operations beside it.
- `src/db/schema/diary-drafts.ts` — the draft table, whose doc comment
  already states Phase 4 owns further evolution of `components`.
- `src/db/schema/diary.ts` — the stub table with `local_date` already present
  for DIARY-01.
- `src/db/schema/users.ts` — `timezone` (default `Asia/Almaty`) and the
  target КБЖУ columns; `timezone` is what D-07 converts against.
- `src/bot/keyboards/onboarding-keyboards.ts` — the established inline
  keyboard + callback-data style to follow.
- `src/domain/nutrition/` — where the CALC-01 function belongs, beside the
  existing BMR/TDEE/target math and its tests.

### Established Patterns
- Hexagonal: `src/domain/**` and `src/application/**` import no grammY, no
  DB driver, no OpenAI SDK.
- Nothing reads `process.env` outside `src/config/env.ts`; nothing connects
  to the DB at import time.
- ESM with `.js` specifiers, `tsx`, Vitest, npm scripts as the owner's
  entire interface.
- User- and operator-facing text is Russian and actionable.
- Migrations: `drizzle-kit generate` + `migrate`, `push` banned, RLS enabled
  with zero policies, owner reviews the SQL first.

### Integration Points
- The inline keyboard attaches to the message Phase 3 already edits in place
  (Phase 3 D-13) — no new message is sent for the card.
- New callback-query handlers register in `createBot()`
  (`src/bot/bot.ts`) **after** the allowlist middleware; registration order
  is asserted by `bot.wiring.test.ts`.
- The text handler that today routes every message into the paid pipeline
  (`src/bot/handlers/meal.ts`) must consult the D-04 awaiting-input flag
  before spending anything.
- `diary` gets its first real writes; Phase 5's DIARY-02/03 views read what
  this phase writes.

</code_context>

<specifics>
## Specific Ideas

- The owner accepted revising a prior-phase decision (Phase 3's D-20) rather
  than preserving it for consistency. The reasoning that carried it: numbers
  are premature on a card you can only read, and necessary on a card you are
  editing. The planner must not "restore" D-20 out of deference to Phase 3 —
  but it must honour the constraint attached to D-03, that preview and final
  numbers come from one function.
- Three separate answers in this discussion chose honesty over convenience —
  the `≥ 12 г (у 1 из 5 нет данных)` total (D-09), blocking confirmation on a
  missing match (D-10), and a hard delete (D-08). Treat that as the tie-break
  rule for any ambiguity the planner meets in this phase: when a shortcut
  would make a number look more complete than it is, take the longer path.

</specifics>

<deferred>
## Deferred Ideas

- **Manual "вчера / сегодня" day switcher on the card** — for logging a meal
  the user forgot to record yesterday. Considered in D-07 and not taken;
  revisit if beta users actually ask for backdating.
- **Progress against daily targets shown right after saving** ("осталось
  620 ккал до цели"). Naturally adjacent, but it is DIARY-02 territory —
  Phase 5.
- **`diary_items` normalised table** — per-component rows for future
  "what do you eat most often" analytics. Rejected for v1 in D-06; the jsonb
  shape can be migrated into rows later if analytics becomes real.
- **Soft delete / undo for diary entries** — rejected in D-08 in favour of a
  confirmed hard delete.
- **Background cleanup job for abandoned drafts** — noted in D-11; it needs a
  scheduler this phase does not have. The transcripts it would remove are
  sensitive data, so this should not be deferred indefinitely.
- **`verify-pipeline` script** (audio → transcript → components → candidates
  → КБЖУ in one report, no Telegram) — carried over from Phase 3's deferred
  list. Now more valuable than ever, since this phase is the first point
  where end-to-end accuracy is actually measurable.

</deferred>

---

*Phase: 4-Confirm/correct + diary persistence*
*Context gathered: 2026-08-14*
