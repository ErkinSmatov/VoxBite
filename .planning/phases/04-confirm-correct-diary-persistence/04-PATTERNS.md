# Phase 4: Confirm/correct + diary persistence - Pattern Map

**Mapped:** 2026-08-14
**Files analyzed:** 16 (13 new, 3 modified)
**Analogs found:** 16 / 16

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/db/schema/diary-drafts.ts` (extend) | model | CRUD | itself (Phase 3) + `src/db/schema/diary.ts` | exact |
| `src/db/schema/diary.ts` (extend: `draftId` FK, no shape change to totals) | model | CRUD | `src/db/schema/diary-drafts.ts` | exact |
| `drizzle/000N_*.sql` (migration for the above) | migration | batch | `drizzle/0003_grey_anthem.sql` / `0006_voice_pipeline_rls.sql` | exact |
| `src/domain/nutrition/calculate-total.ts` | utility (domain pure fn) | transform | `src/domain/nutrition/target-macros.ts` | exact |
| `src/domain/nutrition/calculate-total.test.ts` | test | transform | `src/domain/nutrition/target-macros.test.ts` | exact |
| `src/application/local-date.ts` | utility (application pure fn) | transform | `src/domain/nutrition/target-macros.ts` (pure fn shape) + timezone note in RESEARCH | role-match |
| `src/application/local-date.test.ts` | test | transform | `src/domain/nutrition/target-macros.test.ts` | role-match |
| `src/application/draft-store.ts` (extend: readDraft, updateDraft, expire, claim-confirm CAS) | service | CRUD | itself (`saveDraft`) + `src/application/idempotency.ts` (CAS/claim pattern) | exact |
| `src/application/draft-store.test.ts` (new/extend) | test | CRUD | `src/application/idempotency.test.ts` | exact |
| `src/application/corrections.ts` | service | CRUD/event-driven | `src/application/limits.ts` (Db-param service, fail behavior) + `src/domain/fdc-matching/index.ts` (matchIngredient reuse) | role-match |
| `src/application/corrections.test.ts` | test | CRUD | `src/application/limits.test.ts` | role-match |
| `src/application/confirm-meal.ts` | service | CRUD | `src/application/voice-pipeline.ts` (orchestration shape, never-reject discipline) + `src/application/idempotency.ts` (CAS) | role-match |
| `src/application/confirm-meal.test.ts` | test | CRUD | `src/application/voice-pipeline.test.ts` | role-match |
| `src/application/types.ts` (extend: `DraftAwaitingInput`, correction result types) | model/types | transform | itself (Phase 3) | exact |
| `src/bot/keyboards/correction-keyboards.ts` | component (keyboard builder) | request-response | `src/bot/keyboards/onboarding-keyboards.ts` | exact |
| `src/bot/keyboards/correction-keyboards.test.ts` | test | request-response | `src/bot/keyboards/onboarding-keyboards.test.ts` | exact |
| `src/bot/formatting/correction-card.ts` | component (formatter) | transform | `src/bot/formatting/result-card.ts` | exact |
| `src/bot/formatting/correction-card.test.ts` | test | transform | `src/bot/formatting/result-card.test.ts` | exact |
| `src/bot/formatting/correction-copy.ts` | config (copy strings) | — | `src/bot/formatting/pipeline-copy.ts` | exact |
| `src/bot/telegram/safe-edit.ts` | utility (telegram adapter) | request-response | `src/bot/telegram/ack.ts` (swallow-specific-error pattern) | exact |
| `src/bot/telegram/safe-edit.test.ts` | test | request-response | `src/bot/telegram/ack.test.ts` | exact |
| `src/bot/handlers/correction.ts` | controller | request-response/event-driven | `src/bot/handlers/meal.ts` | exact |
| `src/bot/handlers/correction.test.ts` | test | request-response | `src/bot/handlers/meal.test.ts` | exact |
| `src/bot/handlers/meal.ts` (modify: consult `awaiting_input` before claiming) | controller | request-response | itself | exact |
| `src/bot/bot.ts` (modify: register correction handlers) | config (composition root) | request-response | itself (Phase 3 registration additions) | exact |
| `src/bot/bot.wiring.test.ts` (extend) | test | — | itself | exact |

## Pattern Assignments

### `src/db/schema/diary-drafts.ts` (model, CRUD) — EXTEND

**Analog:** itself (current file) + `src/db/schema/diary.ts` for FK-back shape

**Doc-comment discipline** (lines 1-29 of current file): every schema file opens with a "WHY this table/column exists" comment referencing the decision ID (D-06, D-19, etc.). New columns must follow this — do not add a bare column with no rationale comment.

**Column style** (lines 44-79):
```typescript
export const diaryDrafts = pgTable(
  'diary_drafts',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('draft').$type<'draft' | 'confirmed' | 'abandoned'>(),
    // ...
  },
  (table) => [
    check('diary_drafts_status_check', sql`${table.status} in ('draft','confirmed','abandoned')`),
    unique('diary_drafts_update_id_key').on(table.updateId),
    index('diary_drafts_user_idx').on(table.userId, table.createdAt),
  ],
);

export type DiaryDraftRow = typeof diaryDrafts.$inferSelect;
export type NewDiaryDraft = typeof diaryDrafts.$inferInsert;
```

**Apply to new columns:**
- `awaitingInput: jsonb('awaiting_input')` nullable, `$type<{kind: 'add_component' | 'typed_grams'; componentIndex?: number} | null>()` — D-04.
- `localDate: date('local_date').notNull()` — D-07, frozen at message-receipt (see `diary.localDate` for the exact Drizzle `date()` column type already used).
- `diaryId: integer('diary_id').references(() => diary.id)` nullable, set only on confirm — D-06/Open Question 1's recommended direction, paired with `diary.draftId` NOT NULL (see next entry).
- Extend the `status` union and its `check(...)` constraint together — Postgres check constraints in this codebase always mirror the TS `$type<>()` union (see `users.ts` `sex`/`activityLevel`/`goal` checks for the same paired-constraint convention).

---

### `src/db/schema/diary.ts` (model, CRUD) — EXTEND

**Analog:** current file (already has `localDate`, `kcal`, etc.) + `diary-drafts.ts` for the FK-back convention

**Add:**
```typescript
draftId: integer('draft_id').notNull().references(() => diaryDrafts.id),
```
Update the doc comment (lines 1-10) — it currently says "Phase 4 extends this table with per-component rows"; that plan changed (D-06 rejected a normalised `diary_items` table). Rewrite to state Phase 4 adds `draftId` only, keeping totals denormalised on this row.

---

### `drizzle/000N_*.sql` (migration, batch)

**Analog:** `drizzle/0006_voice_pipeline_rls.sql` (most recent RLS-enabling migration) and `drizzle/0003_grey_anthem.sql` (a generated schema-change migration)

**Workflow (locked by Phase 1, restated in CONTEXT.md):** `drizzle-kit generate` produces the SQL from the schema diff; `push` is banned; owner reviews the SQL before `npm run db:migrate` (or equivalent script) runs. Every new table gets `ENABLE ROW LEVEL SECURITY` with zero policies — but `diary_drafts`/`diary` already have RLS enabled from `0006_voice_pipeline_rls.sql`, so this migration is column-only (`ALTER TABLE ... ADD COLUMN`), no new RLS statements needed unless a wholly new table is introduced (none is, per the file list).

---

### `src/domain/nutrition/calculate-total.ts` (utility, transform)

**Analog:** `src/domain/nutrition/target-macros.ts`

**Imports pattern** (lines 1-10 of `target-macros.ts`):
```typescript
// Target protein/fat/carb grams from the D-04 presets (TECH_SPEC.md §6.4).
import {
  FAT_G_PER_KG,
  KCAL_PER_G_CARB,
  // ...
} from './constants';
```
No grammY, no DB, no external I/O — pure function file, single-line top comment naming the decision it implements.

**Core pattern — validated pure function with defensive input checks** (lines 18-45):
```typescript
export function calculateTargetMacros(weightKg: number, targetKcal: number): TargetMacrosResult {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new Error(`Invalid nutrition profile input: weightKg must be a finite number greater than 0 (got ${weightKg}).`);
  }
  // ... derive one value, clamp defensively, round only at the return
  return { proteinG: Math.round(proteinG), fatG: Math.round(fatG), carbsG: Math.round(carbsG) };
}
```
**Apply to `calculateTotal`:** compute the full sum from scratch every call (RESEARCH.md Pitfall 5 — no incremental/delta math), round only at render/output boundaries per the Open Question 2 recommendation (store raw, round at display). Shape from RESEARCH.md Pattern 3:
```typescript
export interface NutrientTotal {
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  missingCount: Record<'kcal' | 'proteinG' | 'fatG' | 'carbsG' | 'sugarG', number>;
}
```
The domain function returns `null`/`missingCount`, never Russian text — text is `correction-card.ts`'s job (mirrors how `isWeakMatch()` in `application/types.ts` is a pure boolean, and `result-card.ts` turns it into the `⚠️` line).

---

### `src/domain/nutrition/calculate-total.test.ts` (test)

**Analog:** `src/domain/nutrition/target-macros.test.ts`

**Pattern** (whole file, 44 lines): `describe`/`it` blocks with literal expected values for hand-computed cases, an `it.each` table for a general invariant (non-negative/integer), and a separate `it.each` table specifically for invalid-input rejection:
```typescript
it.each([[0, 2000], [-5, 2000], [Number.NaN, 2000]])(
  'throws for invalid input weight=%d kcal=%d',
  (weightKg, targetKcal) => { expect(() => calculateTargetMacros(weightKg, targetKcal)).toThrow(); },
);
```
**Apply to `calculate-total.test.ts`:** literal cases for full-data totals, a case per nutrient with one `null` component (D-09's `missingCount`), a case where ALL components are null for one nutrient (total `null`, not `0`), and the three-sequential-adjustment case RESEARCH.md Pitfall 5 calls out (+10/−10/+10 must equal one direct computation).

---

### `src/application/local-date.ts` (utility, transform)

**Analog:** `target-macros.ts` for the pure-function/doc-comment shape; RESEARCH.md's own `Code Examples` section supplies the body verbatim (already verified in this repo's environment):
```typescript
export function deriveLocalDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
```
No DB/grammY import despite sitting in `application/` (per the Architecture Responsibility Map, it's here rather than `domain/` because callers pass in "now" + a user row's timezone, not because it does I/O itself).

---

### `src/application/local-date.test.ts` (test)

**Analog:** `target-macros.test.ts` structure; RESEARCH.md's regression case for Pitfall 4 (fake clock at 23:55 local, crosses midnight, asserts the frozen day) is the load-bearing test to include — matches the DIARY-01 row in the phase's Test Map.

---

### `src/application/draft-store.ts` (service, CRUD) — EXTEND

**Analog (insert shape):** itself, `saveDraft()`:
```typescript
export async function saveDraft(db: Db, row: NewDiaryDraft): Promise<number> {
  const rows = await db.insert(diaryDrafts).values(row).returning({ id: diaryDrafts.id });
  const inserted = rows[0];
  if (!inserted) { throw new Error('saveDraft: insert returned no row'); }
  return inserted.id;
}
```

**Analog (read + scope-by-user, V4 access control):** `src/application/limits.ts`'s `findOnboardedUser`:
```typescript
export async function findOnboardedUser(db: Db, telegramId: number): Promise<{ id: number } | null> {
  const rows = await db.select({ id: users.id, onboardedAt: users.onboardedAt })
    .from(users).where(eq(users.telegramId, telegramId)).limit(1);
  const user = rows[0];
  if (user === undefined || user.onboardedAt === null) { return null; }
  return { id: user.id };
}
```
**Apply to `readDraft(db, draftId, userId)`:** filter `WHERE id = $draftId AND user_id = $userId` — RESEARCH.md's Security Domain (V4) is explicit that `WHERE id = $draftId` alone is an IDOR bug; never trust a bare id from `callback_data`.

**Analog (conditional-update CAS):** `src/application/idempotency.ts`'s `claimUpdate` (`onConflictDoNothing` + `.returning()`, check `rows.length > 0`) and RESEARCH.md's own sketch for confirm:
```typescript
async function tryClaimConfirm(db: Db, draftId: number): Promise<boolean> {
  const rows = await db.update(diaryDrafts)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.status, 'draft')))
    .returning({ id: diaryDrafts.id });
  return rows.length === 1;
}
```
Use this exact `UPDATE ... WHERE status = 'draft' RETURNING id` pattern for both `confirm` and `del:yes` (Pitfall 3) — zero rows back means "already handled," treat as no-op, never as an error.

**Analog (status-transition helper):** `idempotency.ts`'s `markUpdateStatus` — one function taking `status` as a parameter rather than `markDone`/`markFailed`/... variants:
```typescript
export async function markUpdateStatus(db: Db, updateId: number, status: ProcessedUpdateStatus): Promise<void> {
  await db.update(processedUpdates).set({ status, updatedAt: new Date() }).where(eq(processedUpdates.updateId, updateId));
}
```
Apply the same shape to `markDraftStatus` / `expireIfStale` (D-11).

---

### `src/application/draft-store.test.ts` (test) — EXTEND

**Analog:** `src/application/idempotency.test.ts` — fakes/real-db-against-test-schema pattern already established for this layer; check that file's setup for the exact db-fixture convention before writing new tests.

---

### `src/application/corrections.ts` (service, CRUD/event-driven)

**Analog (Db-param service, fail-open/fail-closed discipline):** `src/application/limits.ts` — every exported function takes `db: Db` as the first parameter (never imports a client), and the module doc comment states the two hard rules (no grammY, no module-level state) verbatim — copy that doc-comment convention.

**Analog (reuse-only matching, never a second query):** `src/domain/fdc-matching/index.ts` barrel:
```typescript
export { matchIngredient } from './match-ingredient';
export type { MatchIngredientArgs } from './match-ingredient';
export { ALLOWED_SOURCES, CANDIDATE_COUNT } from './types';
export type { FdcCandidate, FdcRepository } from './types';
```
`addComponent` MUST import `matchIngredient` from this barrel (never write ad hoc pgvector SQL) and MUST batch/produce its embedding via the SAME `Embedder` (`src/adapters/embeddings/openai-embed.ts`) at the same model/dimensions as the index — see `voice-pipeline.ts` lines 227-246 for the exact call shape (`embedder.embed([...])` then `matchIngredient({ embedding, repo })` per item).

**Text-length bound analog:** `src/bot/handlers/meal.ts` line 54, `MAX_TEXT_LENGTH = 1000` and its refuse-not-truncate comment (lines 192-200) — apply the identical bound-and-refuse pattern to the added-component text before it reaches `matchIngredient`.

---

### `src/application/corrections.test.ts` (test)

**Analog:** `src/application/limits.test.ts` — fake-db/fake-repo test structure for application-layer functions with DB dependencies.

---

### `src/application/confirm-meal.ts` (service, CRUD)

**Analog (orchestration shape, never-reject discipline, staged try/catch):** `src/application/voice-pipeline.ts` — study `processMeal()`'s three invariants for `confirm()`/`editSaved()`/`deleteEntry()`:
1. Every I/O step is individually try/catch'd; failures are logged with `console.error` naming only the operation and id, never health-data content (mirrors lines 104-120's `finish()` helper).
2. Nothing overwrites a result the user already has ("cardDelivered" flag pattern, lines 124-127, 279-330) — once the confirmed card is rendered, a later logging failure must not replace it with an error message.
3. `db.transaction()` or the CAS `UPDATE ... RETURNING` (see `draft-store.ts` entry above) guards the actual state transition; nothing here holds in-memory state across calls.

**Analog (module doc-comment discipline):** every `application/` file in this repo opens with a "why this exists, what invariant it protects" comment block (see `voice-pipeline.ts` lines 1-43, `idempotency.ts` lines 1-30) — `confirm-meal.ts` must do the same, explicitly naming D-06/D-07/D-08.

**Delete pattern:** plain Drizzle `DELETE` (no soft-delete column exists anywhere in this schema — `users`, `diary`, `diary_drafts` all use hard deletes/cascades already, e.g. `users.id` FK `onDelete: 'cascade'` in `diary-drafts.ts` line 50) paired with `markDraftStatus(db, draftId, 'abandoned')` in the same operation, per D-08.

---

### `src/application/confirm-meal.test.ts` (test)

**Analog:** `src/application/voice-pipeline.test.ts` — fake `Db`/fake ports test structure for a multi-step orchestration function.

---

### `src/application/types.ts` (model/types) — EXTEND

**Analog:** itself. Follow the exact established convention for a "one exported rule, multiple callers" derived flag — `isWeakMatch()` (lines 76-82):
```typescript
export function isWeakMatch(candidates: FdcCandidate[]): boolean {
  const top = candidates[0];
  if (!top) { return true; }
  return top.similarity < WEAK_MATCH_SIMILARITY_THRESHOLD;
}
```
D-03's hard constraint ("preview and final numbers come from one function") is this exact precedent applied to `calculateTotal` — do not add a second exported total-computation anywhere.

**New types to add here (not invented ad hoc in `corrections.ts`):** `DraftAwaitingInput` (D-04's flag shape), correction operation result types, mirroring how `DecomposedComponent`/`DraftComponent`/`MealDraft` are all centralized in this one file for Plans 03-04-08 to import.

---

### `src/bot/keyboards/correction-keyboards.ts` (component, request-response)

**Analog:** `src/bot/keyboards/onboarding-keyboards.ts`

**Imports + doc-comment pattern** (lines 1-19): explains why `@grammyjs/menu` is NOT used, referencing the relevant decision — for this phase, cite RESEARCH.md's Alternatives Considered (menu plugin's own state fights CORRECT-07's restart-survival requirement) instead of Phase 2's linearity argument.

**Keyboard-building pattern** (lines 25-41, `buildOptionKeyboard`):
```typescript
export function buildOptionKeyboard<T extends string>(options: readonly Option<T>[], perRow = 1): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((option, index) => {
    kb.text(option.label, option.callbackData);
    const isLast = index === options.length - 1;
    if (!isLast && (index + 1) % perRow === 0) { kb.row(); }
  });
  return kb;
}
```
**Apply to level-1/level-2 builders:** one row per component button (`crc:<draftId>:sel:<idx>`), trailing `➕ Добавить` / `✅ Подтвердить` row — never encode descriptions in `callback_data` (RESEARCH.md Pattern 2's anti-pattern), only `draftId` + short action token + integer index.

**Constant + codec pattern** (lines 61-67, `CONFIRM_CALLBACK`, `buildConfirmKeyboard`): export named constants for fixed callback_data strings so handler regex and keyboard builder can never drift apart — apply the same to `crc:` prefix and every fixed action token (`sel`, `cand`, `g`, `rm`, `back`, `add`, `confirm`, `del`).

---

### `src/bot/keyboards/correction-keyboards.test.ts` (test)

**Analog:** `src/bot/keyboards/onboarding-keyboards.test.ts` — asserts button count, labels and exact `callback_data` strings render correctly for given inputs.

---

### `src/bot/formatting/correction-card.ts` (component, transform)

**Analog:** `src/bot/formatting/result-card.ts` (whole file, 51 lines) — Phase 3 built this so Phase 4 adds to it rather than writing a second card renderer.

**Invariants to preserve verbatim** (lines 1-17, 21-37):
```typescript
function formatComponent(c: DraftComponent): string[] {
  const grams = Math.round(c.grams);
  const lines = [`${c.component} — ${grams} г`];
  const top = c.candidates[0];
  if (top) { lines.push(top.description); } else { lines.push('не нашёл подходящую запись'); }
  if (c.weakMatch) { lines.push('⚠️ совпадение слабое, проверь'); }
  return lines;
}
```
- FDC descriptions shown VERBATIM (D-02).
- Plain text, no `parse_mode` — the caller sends it that way; this module must never assume markdown escaping happens for it.
- Pure function, no I/O, no grammY import.

**Add on top:** the D-03 live `≈` preview line (built from `calculateTotal()`, never a second sum), the D-09 partial-total string (`≥ 12 г (у 1 из 5 нет данных)`), and D-01's two-level rendering (level-1: component list + preview; level-2: single-component candidate/gram editor). Split into `buildCorrectionCard()` (level 1), `buildComponentEditCard()` (level 2), and `buildConfirmedCard()` (post-confirm, no `≈`) — three focused exports rather than one branching mega-function, matching how `result-card.ts` kept `formatComponent` as a private helper under one public export.

---

### `src/bot/formatting/correction-card.test.ts` (test)

**Analog:** `src/bot/formatting/result-card.test.ts` — snapshot/assertion style for rendered card text given a `MealDraft`/`DraftComponent[]` fixture.

---

### `src/bot/formatting/correction-copy.ts` (config, copy strings)

**Analog:** `src/bot/formatting/pipeline-copy.ts` (whole file) — one `export const xCopy = { ... } as const` object, each entry doc-commented with the decision id it implements, zero grammY imports:
```typescript
export const pipelineCopy = {
  ack: 'Секунду, разбираю 🎧',
  noFood: 'Не расслышал, что из еды ты описал. ...',
  // ...
} as const;
```
**Apply to `correctionCopy`:** expiry message (D-11: "этот разбор устарел, отправь сообщение заново"), empty-state (D-12: "компонентов не осталось"), blocked-confirm (D-10, naming the offending component), delete-confirmation prompt (D-08: "Удалить запись? Да / Нет"), every button label. Voice: "state the fact, then state what to do," never blame the user, never leak internals.

---

### `src/bot/telegram/safe-edit.ts` (utility, request-response)

**Analog:** `src/bot/telegram/ack.ts` (whole file, 38 lines) — the "swallow one specific, well-understood Telegram error, never a blanket catch" pattern:
```typescript
export async function ack(ctx: AnswerableCallbackQuery): Promise<void> {
  try {
    await ctx.answerCallbackQuery();
  } catch {
    // "query is too old" / "query already answered" / transient network failure.
    // Never abort the flow.
  }
}
```
**Apply verbatim per RESEARCH.md's own sketch** (Code Examples section) — structurally-typed parameter (not `Context`) for easy unit testing, catch only `GrammyError` whose `description` contains `'message is not modified'`, rethrow everything else:
```typescript
export async function safeEditMessageText(
  ctx: { editMessageText: (text: string, other?: unknown) => Promise<unknown> },
  text: string, other?: unknown,
): Promise<void> {
  try {
    await ctx.editMessageText(text, other);
  } catch (err) {
    if (err instanceof GrammyError && err.description?.includes('message is not modified')) { return; }
    throw err;
  }
}
```

---

### `src/bot/telegram/safe-edit.test.ts` (test)

**Analog:** `src/bot/telegram/ack.test.ts` — two-line fake ctx, assert the specific error is swallowed and any other error propagates.

---

### `src/bot/handlers/correction.ts` (controller, request-response/event-driven)

**Analog:** `src/bot/handlers/meal.ts` (whole file) — `createXHandler(deps)`-closure-over-deps factory shape, injectable-override deps interface:
```typescript
export interface MealHandlerDeps {
  db: Db;
  token: string;
  deps: PipelineDeps;
  claimUpdate?: typeof claimUpdateReal;
  // ...
}
export function createVoiceHandler(d: MealHandlerDeps) {
  const claimUpdate = d.claimUpdate ?? claimUpdateReal;
  // ...
  return async (ctx: BotContext): Promise<void> => { /* gated steps, numbered comments */ };
}
```
**Gate-order discipline (module doc comment, lines 9-33):** every handler here documents its numbered gate order as "the phase's entire spend-control/correctness story — do not reorder without re-reading the plan." `correction.ts` needs the equivalent for Pattern 1 (RESEARCH.md): callback handlers ALWAYS `readDraft()` fresh before doing anything, verify `draft.userId === resolvedUser.id` (IDOR guard), then check `abandoned`/expired before dispatching the action.

**`ack()` usage (mirrors `bot.ts` line 112-119's callback pattern):**
```typescript
bot.callbackQuery(RESTART_ONBOARDING_CALLBACK, async (ctx) => {
  await ack(ctx);
  await ctx.conversation.enter(ONBOARDING_CONVERSATION_ID);
});
```
Every `crc:` callback handler must call `ack(ctx)` first (RESEARCH.md's Pattern 1 sketch already shows this), and every edit call goes through `safeEditMessageText` (new).

**Text-interception gate (D-04, Pitfall 2):** modify `src/bot/handlers/meal.ts`'s `createTextHandler` (lines 151-217) to check `awaiting_input` BEFORE step 1 (`claimUpdate`) — read the draft-by-user's-awaiting-flag first; if set, hand off to the correction operation instead of falling through to `claimUpdate`/pipeline. This is a modification to an EXISTING file, not a new one — see meal.ts row in classification table.

---

### `src/bot/handlers/correction.test.ts` (test)

**Analog:** `src/bot/handlers/meal.test.ts` — fake-ctx/fake-deps handler test structure, asserting gate order and copy selection per branch.

---

### `src/bot/bot.ts` (config, composition root) — EXTEND

**Analog:** itself — the Phase 3 addition pattern (lines 121-140):
```typescript
// Phase 3: voice/text meal handlers, registered LAST within section 5 so
// commands keep winning over the text handler...
const mealDeps = buildMealHandlerDeps({ db: deps.db, token: deps.token, api: bot.api, sttModel: deps.sttModel });
bot.on('message:voice', createVoiceHandler(mealDeps));
bot.on('message:text', createTextHandler(mealDeps));
```
**Apply:** register `bot.callbackQuery(/^crc:/, ...)` and the correction text-interceptor AFTER the allowlist gate (section 1) — the existing invariant `bot.wiring.test.ts` already enforces generically ("every `bot.on/command/callbackQuery` call after `createAllowlistMiddleware`"). The one NEW ordering fact to add a test for: the correction text-interceptor must run BEFORE (or subsume) `createTextHandler`'s claim step, since D-04 routes text away from the paid pipeline when `awaiting_input` is set — this is most simply done inside `meal.ts`'s existing handler (see above) rather than as a second competing `bot.on('message:text', ...)` registration, since grammY dispatches to only the first matching handler that doesn't call `next()`.

---

### `src/bot/bot.wiring.test.ts` (test) — EXTEND

**Analog:** itself — source-text-order tripwire style (whole file). Add a `describe('bot.ts Phase 4 correction-handler registrations')` block mirroring the Phase 3 block (lines 55-98): assert `bot.callbackQuery` for the `crc:` pattern appears, assert it's positioned after the allowlist call, and assert `meal.ts`'s text handler references the awaiting-input check (a source-text grep for the function/flag name, same tripwire-not-proof caveat already documented at the top of the file, lines 1-13).

---

## Shared Patterns

### Draft-row-as-source-of-truth (never trust the tapped button)
**Source:** RESEARCH.md Pattern 1, `src/application/limits.ts`'s scoped-lookup convention
**Apply to:** every function in `corrections.ts`, `confirm-meal.ts`, and every handler in `correction.ts`
```typescript
const draft = await readDraft(db, draftId, userId); // WHERE id=$1 AND user_id=$2, never id alone
if (!draft || draft.status === 'abandoned') { /* expired copy, strip keyboard */ }
```

### Never a second nutrient-summation implementation
**Source:** `src/application/types.ts`'s `isWeakMatch()` precedent; D-03's hard constraint
**Apply to:** `correction-card.ts`'s live preview AND `confirm-meal.ts`'s final save — both call `calculateTotal()` from `domain/nutrition/calculate-total.ts`, never a parallel sum.

### Swallow-one-specific-error, never a blanket catch
**Source:** `src/bot/telegram/ack.ts`
**Apply to:** `src/bot/telegram/safe-edit.ts` (new) — swallow only `GrammyError` with `'message is not modified'`, rethrow everything else; the same philosophy that already governs `ack()`.

### Conditional-UPDATE compare-and-swap for correctness-critical writes
**Source:** `src/application/idempotency.ts`'s `claimUpdate` (`onConflictDoNothing` + `.returning()`)
**Apply to:** `draft-store.ts`'s confirm/delete claim (`UPDATE ... WHERE status='draft' RETURNING id`) — zero-row return means "already handled," not an error (Pitfall 3). Do NOT apply full CAS to ±10g adjustments (accepted low-severity nuisance per RESEARCH.md's explicit call-out — state this reasoning inline in the plan, per CLAUDE.md's "don't agree by default silently" instruction).

### Never-reject orchestration with a "already delivered" guard
**Source:** `src/application/voice-pipeline.ts`'s `processMeal()` (`draftSaved`/`cardDelivered` flags, `handleLateFailure`)
**Apply to:** `confirm-meal.ts`'s `confirm()`/`editSaved()`/`deleteEntry()` — a late-stage failure (e.g. logging) must never overwrite a result the user already received.

### Db-as-parameter, zero module-level state, zero grammY imports in `application/`
**Source:** module doc comments on every file in `src/application/` (see `voice-pipeline.ts` lines 1-43, `limits.ts` lines 1-26, `idempotency.ts` lines 1-30)
**Apply to:** every new file under `src/application/` — open with the same "why this exists / two hard rules" doc-comment block.

### Russian copy centralized in one `*-copy.ts` module per feature
**Source:** `src/bot/formatting/pipeline-copy.ts`, `onboarding-copy.ts`, `error-copy.ts`
**Apply to:** `src/bot/formatting/correction-copy.ts` — one `as const` object, each string doc-commented with its decision id, zero grammY imports, "state the fact then the action" voice.

### IDOR guard on every draft/diary access (V4 Access Control)
**Source:** RESEARCH.md Security Domain table; `limits.ts`'s scoped queries
**Apply to:** every read/write in `corrections.ts`, `confirm-meal.ts`, `draft-store.ts` — filter by `(id, userId)` together, resolved from `ctx.from.id` upstream in the handler, never `id` alone.

## No Analog Found

None — every file this phase touches has a direct, current-codebase precedent. This phase is explicitly framed by CONTEXT.md/RESEARCH.md as composing Phase 1-3 primitives rather than introducing new architectural shapes.

## Metadata

**Analog search scope:** `src/domain/`, `src/application/`, `src/bot/handlers/`, `src/bot/keyboards/`, `src/bot/formatting/`, `src/bot/telegram/`, `src/db/schema/`, `drizzle/`
**Files scanned:** 16 source files read in full (all under repo's stated size limits; no file exceeded 2,000 lines, no `Read` re-reads of the same range)
**Pattern extraction date:** 2026-08-14
