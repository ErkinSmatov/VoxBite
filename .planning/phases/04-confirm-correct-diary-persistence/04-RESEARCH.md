# Phase 4: Confirm/correct + diary persistence - Research

**Researched:** 2026-08-14
**Domain:** grammY inline-keyboard state machines, Postgres draft persistence, deterministic nutrition math, timezone-correct date bucketing
**Confidence:** HIGH (grammY/Telegram mechanics, existing codebase patterns) / MEDIUM (timezone edge cases, concurrency approach — no prior-phase precedent to lean on)

## Summary

Phase 4 does not introduce a new stack — it composes primitives Phase 1-3 already
established (plain `InlineKeyboard`, `Db`/Drizzle, the hexagonal `domain/`↔`application/`↔`bot/`
split, Postgres RLS-with-zero-policies) into a stateful two-level correction UI over the
single message Phase 3 already owns. The two technically novel pieces are (1) a
Telegram-callback state machine that must survive process restarts and re-derive its
current screen from a Postgres row on every tap, and (2) timezone-correct "which calendar
day does this belong to" logic, which Node's built-in `Intl.DateTimeFormat` handles without
any new dependency — no `luxon`/`date-fns-tz` needed at this project's scale (single IANA
zone per user, no recurring-event math).

No new npm packages are required for this phase. `@grammyjs/menu` (already resolvable at
1.4.0, and explicitly deferred to this phase by 02-RESEARCH.md) was evaluated and is
**not recommended** — D-01's two-level, single-message-redraw design is simpler to build
and test as a plain `InlineKeyboard` + `callbackQuery` handler pair reading/writing one
Postgres row than as a `@grammyjs/menu` `Menu` instance, because the menu plugin's own
in-memory navigation stack is exactly the kind of state ARCHITECTURE.md's Anti-Pattern 4
forbids holding outside Postgres — every navigation decision in this phase must be
re-derivable from the draft row alone (CORRECT-07), which a menu plugin's own state
management does not buy anything for and would fight against.

**Primary recommendation:** Extend `diary_drafts` with the columns D-04/D-06/D-07 imply
(`awaiting_input` jsonb, `local_date`, `diary_id`), keep the correction UI as plain
`InlineKeyboard` + `bot.callbackQuery(/^crc:/, ...)` reading the current draft row fresh on
every tap (never trusting cached UI state), compute CALC-01 in one pure exported function
shared by the D-03 live preview and the final save, and derive `local_date` once via
`Intl.DateTimeFormat` at message-receipt time (already the D-07-mandated freeze point).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Two-level correction card rendering & keyboard building | Bot (Telegram adapter, `src/bot/keyboards/`, `src/bot/formatting/`) | — | Pure Telegram markup construction; must import grammY, so cannot live in `application/`/`domain/` per the hexagonal rule already enforced in this repo |
| Draft state read/mutate (swap candidate, adjust grams, remove, add, awaiting-input flag) | Application (`src/application/`) | Database (Postgres via Drizzle) | Orchestration logic that must never hold state in memory (Anti-Pattern 4); every operation is a read-then-write against `diary_drafts` |
| CALC-01 nutrient math (grams × per-100g, partial-total rule) | Domain (`src/domain/nutrition/`) | — | Pure function, zero I/O — exactly the pattern `bmr-tdee.ts`/`target-calories.ts` already establish; must be unit-testable with fakes and importable by both the live preview and the final save |
| Added-component FDC matching | Domain (`src/domain/fdc-matching/`) via Application orchestration | Adapters (`Embedder`) | Reuses `matchIngredient()` verbatim (CORRECT-06 constraint) — no new matching logic |
| Diary day (`local_date`) derivation | Application (at message-receipt time, frozen per D-07) | — | Needs `users.timezone` + the message timestamp; a pure conversion, but it consumes I/O-adjacent inputs (current time, user row) so it sits in `application/`, not `domain/` |
| `diary` row write/update/delete | Database (Postgres) | Application (`src/application/`) | Direct Drizzle calls from an application-layer module, same as `draft-store.ts`/`idempotency.ts` today |
| Callback routing, ack(), text-vs-correction dispatch | Bot (`src/bot/bot.ts`, `src/bot/handlers/`) | — | Telegram-specific dispatch; must consult D-04's `awaiting_input` flag before the existing text handler claims a message for the paid pipeline |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `grammy` | 1.45.1 (already installed) | `InlineKeyboard`, `bot.callbackQuery()` | Already the project's bot framework (STACK.md); no new capability needed for a two-level redraw-in-place UI |
| `drizzle-orm` | already installed (0.4x line per package.json — verify exact via `npm ls drizzle-orm`) | `diary_drafts`/`diary` reads, writes, `db.transaction()` | Already the project's ORM; this phase's writes are simple update-by-id and insert/delete, no new query shapes |
| `zod` | 4.4.3 (already installed) | Validating typed-grams free-text input (`"200"`, `"200 г"`, `"200г"`) before it reaches domain math | Already the project's validation library (used for LLM structured output); a hand-rolled regex-only parser for user-typed numbers is fine too, but funnelling it through a `z.coerce.number()` + `.refine()` pipeline is consistent with the codebase's existing validation style |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node built-in `Intl.DateTimeFormat` | Node 22 LTS built-in | Convert a UTC `Date` into a user's local calendar date string (`YYYY-MM-DD`) for `local_date` | Always — see Don't Hand-Roll and Code Examples below. No package needed. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain `InlineKeyboard` + `callbackQuery` regex dispatch | `@grammyjs/menu` (1.4.0) | `@grammyjs/menu`'s `Menu` instances keep navigation state (which submenu is "current") partly in the menu object graph built at startup and partly in a `payload`/session mechanism — fine for stateless menus, but this phase's whole point is that every tap must be resolvable purely from Postgres after a restart (CORRECT-07). Rolling a thin, explicit `crc:<draftId>:<action>:<idx>` callback-data scheme keeps that invariant obvious and testable without learning the plugin's session semantics. Revisit only if the correction UI grows a third level or shared cross-draft menus. |
| `Intl.DateTimeFormat` for timezone conversion | `luxon` or `date-fns-tz` | Both are more ergonomic for complex calendar math (recurring events, DST-aware arithmetic across ranges), which this phase does not need — it needs exactly one operation: "what calendar date is this UTC instant in this IANA zone." `Intl.DateTimeFormat` with `timeZone` option does this correctly (validated below) using zero new dependencies, which matters for a solo backend-inexperienced owner who now has one fewer package's security advisories to track. |
| Optimistic concurrency via a `version`/`updated_at` compare-and-swap column | Postgres row-level locking (`SELECT ... FOR UPDATE`) | This is a single-user-editing-their-own-row scenario (no multi-user contention on one draft), so the realistic race is the SAME user double-tapping a button before the first tap's edit lands, not two different users. A plain read-then-write with each callback handler re-reading the current row is sufficient; `FOR UPDATE` row locks add transaction-lifetime complexity this phase's actual risk profile does not need. See Common Pitfalls for the double-tap mitigation that matters instead (idempotent redraw, not locking). |

**Installation:** none — every dependency this phase needs is already in `package.json` or built into Node.

**Version verification:** `grammy@1.45.1`, `zod@4.4.3`, `@grammyjs/menu@1.4.0` (latest, confirmed via `npm view`, not being adopted — see Alternatives) [VERIFIED: npm registry, 2026-08-14].

## Architecture Patterns

### System Architecture Diagram

```
Telegram callback_query (button tap)          Telegram text message (typed grams / add component)
        │                                                    │
        ▼                                                    ▼
bot.callbackQuery(/^crc:/) handler          bot.on('message:text') handler
        │  parse draftId+action from                │  read draft row: awaiting_input set?
        │  callback_data (bot/)                      │    NO  → fall through to existing
        ▼                                             │        VOICE-04 meal pipeline (Phase 3)
readDraft(db, draftId)  ──────────────────────────────┘    YES → route into correction op below
   (application/)
        │
        ▼
apply correction operation (application/):
  swapCandidate | adjustGrams | removeComponent
  | addComponent | confirm | editSaved | delete
        │                       │
        │            addComponent only:
        │            matchIngredient() (domain/fdc-matching)
        │            ← Embedder.embed() (adapters/)
        ▼
recompute preview via CALC-01 pure fn (domain/nutrition)
        │
        ▼
persist updated draft row (UPDATE diary_drafts)
        │
        ├─ confirm path: derive local_date (frozen at original message time,
        │   not now) → INSERT diary row → UPDATE diary_drafts.status='confirmed'
        │   + diary_drafts.diary_id
        │
        └─ delete path: DELETE diary row → UPDATE diary_drafts.status='abandoned'
        │
        ▼
buildCorrectionCard() / buildConfirmedCard() (bot/formatting/)
        │
        ▼
editMessageText/editMessageReplyMarkup on the SAME message_id (D-13 lineage)
        │
        ▼
ack() the callback query (swallow "too old"/"already answered")
```

### Recommended Project Structure
```
src/
├── domain/
│   └── nutrition/
│       ├── calculate-total.ts     # CALC-01: pure grams×per-100g sum + partial-total rule (D-09)
│       └── calculate-total.test.ts
├── application/
│   ├── types.ts                   # extend: DraftAwaitingInput, CorrectionResult, etc.
│   ├── draft-store.ts             # extend: readDraft, updateDraftComponents, expireIfStale (D-11)
│   ├── corrections.ts             # NEW: swapCandidate, adjustGrams, removeComponent, addComponent, applyTypedGrams
│   ├── confirm-meal.ts            # NEW: confirm() -> diary insert, editSaved(), deleteEntry()
│   └── local-date.ts              # NEW: deriveLocalDate(instant, ianaTimezone)
├── bot/
│   ├── keyboards/
│   │   └── correction-keyboards.ts # NEW: level-1/level-2 InlineKeyboard builders, callback_data codec
│   ├── formatting/
│   │   ├── correction-card.ts      # NEW: extends result-card.ts's invariants (verbatim FDC text, no parse_mode)
│   │   └── correction-copy.ts      # NEW: every Russian string for this phase, zero grammY imports
│   └── handlers/
│       └── correction.ts           # NEW: callbackQuery + text-interception handlers
└── db/schema/
    ├── diary-drafts.ts             # extend: awaitingInput jsonb, localDate date, diaryId FK
    └── diary.ts                    # no shape change needed (already has local_date, kcal, etc.)
```

### Pattern 1: Draft-row-as-source-of-truth callback dispatch
**What:** Every `callbackQuery` handler's FIRST action is `readDraft(db, draftId)` — never trust
what screen the tapped keyboard implies. If the row is `abandoned`, `confirmed` (for a
pre-confirm action), or older than 24h (D-11) and still `draft`, answer with the expiry/']
state copy and strip the keyboard instead of applying the correction.
**When to use:** Every correction/confirm/edit/delete callback handler.
**Example:**
```typescript
// bot/handlers/correction.ts — sketch, not final code
bot.callbackQuery(/^crc:(\d+):(.+)$/, async (ctx) => {
  await ack(ctx);
  const draftId = Number(ctx.match[1]);
  const action = ctx.match[2];
  const draft = await readDraft(deps.db, draftId);
  if (!draft || draft.status === 'abandoned') {
    await ctx.editMessageText(correctionCopy.expired);
    return;
  }
  if (draft.status === 'draft' && isExpired(draft.createdAt)) {
    await markExpired(deps.db, draftId);
    await ctx.editMessageText(correctionCopy.expired);
    return;
  }
  // ...dispatch `action` to the matching application-layer operation
});
```

### Pattern 2: callback_data codec — short, ASCII, id-based, never descriptive
**What:** `callback_data` is capped at 64 **bytes**, not characters, and UTF-8 bytes stack up
fast on Cyrillic content [VERIFIED: Telegram Bot API — InlineKeyboardButton.callback_data
spec, cross-referenced via grammY docs and community sources]. Encode only integers/short
tokens: `crc:<draftId>:sel:<idx>` (level-1 pick component), `crc:<draftId>:cand:<0|1|2>`
(level-2 pick candidate), `crc:<draftId>:g:<-10|+10>`, `crc:<draftId>:g:type`, `crc:<draftId>:rm`,
`crc:<draftId>:back`, `crc:<draftId>:add`, `crc:<draftId>:confirm`, `crc:<draftId>:del`,
`crc:<draftId>:del:yes`. `draftId` is the `diary_drafts.id` integer identity column — always
small, always ASCII, well within budget even with the longest action token.
**When to use:** Every button this phase adds.
**Anti-pattern avoided:** Encoding the FDC description or component name into callback_data —
besides the byte budget, the description is already visible in the message text (D-02); the
button only needs to say "which of these" via an index.

### Pattern 3: One preview function, two callers (D-03's hard constraint)
**What:** `calculateTotal(components: {grams, kcal, proteinG, fatG, carbsG, sugarG}[])` in
`domain/nutrition/` is called both by the correction-card renderer (live "≈" preview) and by
the confirm operation (final save). Never write a second "approximate" summation.
**When to use:** Anywhere a total КБЖУ/sugar number is shown or persisted.
**Example:**
```typescript
// domain/nutrition/calculate-total.ts — sketch
export interface NutrientTotal {
  kcal: number | null;      // null only if ALL contributing components lack the nutrient
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  sugarG: number | null;
  missingCount: Record<'kcal' | 'proteinG' | 'fatG' | 'carbsG' | 'sugarG', number>;
}

export function calculateTotal(
  items: { grams: number; kcal: number | null; proteinG: number | null; fatG: number | null; carbsG: number | null; sugarG: number | null }[],
): NutrientTotal {
  // for each nutrient key: sum over items where value is not null,
  // track how many items had null for that key (D-09's "у N из M нет данных")
  // if ALL items are null for a key -> total is null for that key (не "нет данных" text — that's the formatter's job)
}
```
The formatter (`correction-card.ts`) turns `missingCount.kcal > 0` into the
`≥ 12 г (у 1 из 5 нет данных)` string (D-09); the domain function never produces Russian text.

### Anti-Patterns to Avoid
- **Redrawing identical content on `editMessageText`:** Telegram returns `400: message is not
  modified` when the new text AND reply_markup are byte-identical to the current message
  [VERIFIED via WebSearch, multiple independent reports of this exact error string]. This WILL
  happen in normal use here: tapping `← Назад` back to an unchanged level-1 screen, or
  re-selecting the already-chosen candidate. Every edit call in this phase's handlers must
  catch and swallow this specific error (mirroring the existing `ack()` swallow-pattern for
  stale callbacks) rather than let it surface as an unhandled rejection.
- **Trusting the tapped button's implied state instead of re-reading the draft row:** the
  bot process can restart between rendering a keyboard and the user tapping it; a handler
  that computes the next screen from `ctx.match` alone (without re-reading Postgres) can
  redraw a screen inconsistent with the actual persisted state.
- **A second nutrient-summation implementation for the preview:** see Pattern 3 — this is
  explicitly the trap D-03 calls out by name (never let the pipeline and the formatter
  disagree, mirroring `isWeakMatch`'s precedent).
- **Recomputing `local_date` at confirmation time instead of at original-message time:**
  D-07 is explicit that the day freezes at message receipt; recomputing it at confirm-time
  reintroduces the midnight-boundary bug D-07 exists to prevent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| UTC instant → user's local calendar date | A manual UTC-offset lookup table or a hand-rolled DST calculator | `Intl.DateTimeFormat('en-CA', { timeZone: user.timezone, year:'numeric', month:'2-digit', day:'2-digit' }).format(date)` (built into Node ≥ 14, confirmed on Node 22) | IANA timezone database (DST rules, historical offset changes) ships with V8/ICU in Node itself; `en-CA` locale formats as `YYYY-MM-DD` directly, matching Postgres's `date` column input format with no string surgery [VERIFIED: ran locally against Node in this repo's environment, confirmed `2026-08-13T23:50:00Z` → `Asia/Almaty` → `2026-08-14`] |
| Typed-gram text parsing (`"200"`, `"200 г"`, `"200г"`) | A bespoke multi-branch string parser | `zod`'s `z.string().transform(s => s.replace(/[^\d.]/g, '')).pipe(z.coerce.number().positive())`-style pipeline, OR a small hand-written regex — either is fine at this scope, but validate through one function with one set of tests, not inline in the handler | Small enough that either choice is legitimate (this is explicitly Claude's Discretion in CONTEXT.md); the "don't hand-roll" risk here is not the parser itself but scattering grams-parsing logic across multiple handler call sites so a nonsense-rejection rule silently diverges between "add component" and "adjust grams" |
| FDC re-matching for an added component | A second, ad hoc pgvector query in `application/` | `matchIngredient()` from `src/domain/fdc-matching/index.ts`, fed an embedding from the SAME `Embedder` instance/model/dimensions the runtime pipeline already uses | CORRECT-06's explicit constraint; a hand-written query would risk silently drifting from the ORDER-BY-raw-distance invariant Phase 1 fixed after a real regression (01-CONTEXT.md) |
| Rounding money-adjacent nutrient numbers | Ad hoc `Math.round()` calls scattered through formatters | One rounding convention decided once in `calculate-total.ts`/the formatter and reused everywhere numbers are shown (preview AND confirmed card AND diary row) | Inconsistent rounding between the "≈" preview and the final saved number (e.g. preview rounds up, save floors) reads as a bug even though both are "correct" — pick one rule (e.g. round-half-up at render time only, store raw floats) and apply it everywhere |

**Key insight:** this phase's actual hand-rolling risk is not exotic algorithms — it's
letting the SAME computation (nutrient totals, expiry check, weak-match flag) exist in two
places that can drift. Every pattern above is really the same rule restated: one function,
multiple callers, never a parallel reimplementation.

## Common Pitfalls

### Pitfall 1: "message is not modified" 400 breaks the correction flow
**What goes wrong:** User taps `← Назад` when nothing changed since the last level-1 render,
or re-taps the already-selected candidate; `editMessageText`/`editMessageReplyMarkup` throws.
**Why it happens:** Telegram diffs the new content+markup against the current message and
refuses a no-op edit as an API-level validation, not an application bug.
**How to avoid:** Wrap every edit call in this phase in a try/catch that specifically
recognizes this error (grammY surfaces it as a `GrammyError` with `description` containing
"message is not modified") and swallows it silently — same philosophy as `ack()`'s existing
swallow of stale-callback errors. Do not let it propagate to `bot.catch()`.
**Warning signs:** Intermittent "internal error" replies on `← Назад` or repeat taps during
manual testing.

### Pitfall 2: Text-handler collision between free-form correction input and the paid pipeline
**What goes wrong:** Without the D-04 `awaiting_input` gate, a user's typed grams number
("200") or added-component text after tapping `➕ Добавить`/`⌨ Ввести граммы` gets routed
into `createTextHandler` (Phase 3) and triggers a full paid decomposition of "200" or
"курица" as if it were a new meal.
**Why it happens:** `bot.on('message:text')` (Phase 3) is registered globally and has no
knowledge this phase's correction flow exists yet.
**How to avoid:** The correction text-interception handler MUST be registered and MUST check
`awaiting_input` (a column/flag on the draft row keyed by `telegramId`/`chatId`, not held in
memory) BEFORE Phase 3's `createTextHandler` claims the update — registration order in
`bot.ts` is load-bearing here exactly as it already is for the allowlist gate (see
`bot.wiring.test.ts`'s existing order-assertion pattern; this phase should extend that
pattern to cover the new handler's position, given `bot.on('message:text')` can only be
registered once per exact matcher and grammY dispatches in registration order until a
handler calls `next()`).
**Warning signs:** A user reports "I typed grams and it charged me / gave a weird meal
result instead of updating the grams."

### Pitfall 3: Double-tap race on ±10g / confirm buttons
**What goes wrong:** A user taps `+10` twice quickly (network lag, impatience); two
`callbackQuery` updates arrive close together, both read the draft row before either write
lands, both compute "+10 from the same base," and the second write clobbers the first —
net effect is +10 instead of +20, or (worse, on `confirm`) two `diary` rows get inserted.
**Why it happens:** No coordination between concurrent callback handler invocations for the
same draft; grammY processes updates concurrently unless explicitly sequenced.
**How to avoid:** For `confirm`/`del:yes` specifically (the two operations where a duplicate
write is a real correctness bug, not just an off-by-10g annoyance), guard with a status
check inside the same operation that performs the write: only insert into `diary` when
`diary_drafts.status = 'draft'` and the UPDATE that flips it to `'confirmed'` happens in the
same transaction/round-trip as the check (`UPDATE diary_drafts SET status='confirmed' WHERE
id=$1 AND status='draft' RETURNING id` — a conditional update is a natural compare-and-swap
here without a separate version column). If zero rows come back, treat it as "already
confirmed" and no-op rather than erroring. For ±10g, exact double-application is a real but
low-severity nuisance (user can just tap −10) — do not over-engineer a lock for it.
**Warning signs:** Duplicate diary entries for one confirmed meal; support report of "I only
tapped confirm once."

### Pitfall 4: `local_date` derived at the wrong instant
**What goes wrong:** Recomputing `local_date` at confirm time (rather than reading the value
frozen at original-message receipt) silently reassigns a late-night meal to the wrong day if
the user confirms after local midnight.
**Why it happens:** It is tempting to compute `local_date` inline inside the confirm
operation "since that's when we actually write the diary row" — but D-07 requires the value
be frozen earlier.
**How to avoid:** `local_date` is computed once, in Phase 3's `processMeal()` or immediately
adjacent to it (this phase extends that write path), from the message's own receipt
timestamp and `users.timezone`, and stored on the `diary_drafts` row. The confirm operation
only ever COPIES that stored value into `diary.local_date` — it never recomputes it.
**Warning signs:** A unit test that freezes "now" at 23:55 user-local, creates a draft, waits
(simulated) past midnight, confirms, and asserts the diary row's `local_date` still matches
the ORIGINAL day — this is exactly the regression test this pitfall implies and should exist
in this phase's plan.

### Pitfall 5: Floating-point drift between the preview and the stored total
**What goes wrong:** JS `number` arithmetic on repeated small adjustments (many ±10g taps,
each triggering a fresh `calculateTotal()` call) is not itself a source of meaningful drift
since each call recomputes from the current `grams` values rather than accumulating — but a
naive implementation that mutates a running total incrementally (rather than recomputing
`grams × per100g` fresh from the authoritative component list each time) WILL drift and can
also disagree with the final save.
**Why it happens:** Incremental "just add the delta" optimization looks harmless but breaks
the "one function computes the whole total from source values" invariant Pattern 3 requires.
**How to avoid:** `calculateTotal()` always takes the full current component array and sums
from scratch — O(n) per call, n ≤ ~6 components, negligible cost, and it is the only way to
guarantee the preview and the final save can never diverge.
**Warning signs:** A test where three sequential adjustments (+10, −10, +10) do not equal a
single direct computation.

## Code Examples

### Timezone-correct local date derivation
```typescript
// application/local-date.ts — verified locally against Node 22 in this repo's environment
export function deriveLocalDate(instant: Date, timezone: string): string {
  // en-CA locale formats as YYYY-MM-DD directly — no manual string reassembly,
  // and Intl's IANA timezone database handles DST/historical-offset changes
  // that a hand-rolled offset table would get wrong.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
// deriveLocalDate(new Date('2026-08-13T23:50:00Z'), 'Asia/Almaty') === '2026-08-14'
// (Asia/Almaty is UTC+5/UTC+6 depending on historical rules the ICU database tracks)
```

### Conditional-update as a lightweight compare-and-swap (Pitfall 3)
```typescript
// application/confirm-meal.ts — sketch
import { and, eq } from 'drizzle-orm';
import { diaryDrafts } from '../db/schema/diary-drafts.js';

async function tryClaimConfirm(db: Db, draftId: number): Promise<boolean> {
  const rows = await db
    .update(diaryDrafts)
    .set({ status: 'confirmed', updatedAt: new Date() })
    .where(and(eq(diaryDrafts.id, draftId), eq(diaryDrafts.status, 'draft')))
    .returning({ id: diaryDrafts.id });
  return rows.length === 1; // false => already confirmed/abandoned by a concurrent tap
}
```

### Swallowing the "message is not modified" edit error (Pitfall 1)
```typescript
// bot/telegram/safe-edit.ts — sketch, mirrors ack()'s existing swallow philosophy
import { GrammyError } from 'grammy';

export async function safeEditMessageText(
  ctx: { editMessageText: (text: string, other?: unknown) => Promise<unknown> },
  text: string,
  other?: unknown,
): Promise<void> {
  try {
    await ctx.editMessageText(text, other);
  } catch (err) {
    if (err instanceof GrammyError && err.description?.includes('message is not modified')) {
      return; // no-op edit — not an error condition, see 04-RESEARCH.md Pitfall 1
    }
    throw err;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Phase 3 D-20: no КБЖУ numbers on the card | D-03 (this phase): live "≈" preview on every correction | 2026-08-14 (04-CONTEXT.md) | Explicit, owner-approved revision; the planner must implement the preview, not restore D-20 |

**Deprecated/outdated:** none — this phase does not deprecate any existing code, it extends
`diary-drafts.ts`'s schema and adds buttons to `result-card.ts`'s successor.

## Project Constraints (from CLAUDE.md)

- Owner is a frontend/React developer with no backend experience: any setup step this phase
  introduces (there should be none beyond the standard `drizzle-kit generate` + owner-reviewed
  migration + `db:migrate` flow already established) must be spelled out literally, per prior
  phases' pattern.
- Final КБЖУ/sugar figures MUST be computed mathematically (grams × FDC per-100g), never by
  an LLM — this is the phase's entire reason to exist (CALC-01) and is already the locked
  architecture.
- Every component match still goes through embedding-based vector search against USDA FDC —
  CORRECT-06's added component is no exception.
- User must confirm/correct before anything is treated as final — this phase IS that
  confirmation step.
- Voice message retention: not touched by this phase (no audio persists past Phase 3's STT
  call); this phase only persists text (transcript, component names) already governed by
  Phase 3's decisions.
- Do not agree by default: flag risky choices before implementing. Two choices in this
  research carry real risk if the planner treats them as settled rather than confirming: (1)
  the double-tap mitigation scope (full CAS only for confirm/delete, not ±10g) trades a rare
  minor annoyance for implementation simplicity — reasonable, but call it out explicitly in
  the plan rather than silently deciding it; (2) skipping `@grammyjs/menu` in favor of hand
  rolled callback dispatch is a real API-surface decision, not a trivial default — it is
  justified above (Alternatives Considered) but the plan should state the reasoning inline so
  a reviewer does not need to re-derive it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `@grammyjs/menu`'s internal navigation/session handling would work against, not with, CORRECT-07's restart-survival requirement | Standard Stack / Alternatives | If wrong, the plugin might actually simplify this phase's keyboard code without violating the requirement — but the training-data-level understanding of the plugin's storage model was not re-verified against its current docs via Context7/WebFetch in this session (only npm version was checked). LOW-MEDIUM risk: worst case is the planner reinvents something the plugin already solved, not a correctness bug, since the "raw InlineKeyboard" fallback is definitely restart-safe. |
| A2 | A plain conditional `UPDATE ... WHERE status='draft' RETURNING id` is sufficient compare-and-swap protection for the confirm/delete double-tap race, without a dedicated `version` column | Common Pitfalls / Pitfall 3 | If Postgres's read-committed isolation somehow allows two concurrent UPDATEs to both see `status='draft'` as true before either commits (it should not, under standard MVCC row-level locking — this is a well-established Postgres guarantee, not project-specific), a duplicate diary row could still occur. This is standard Postgres behavior [VERIFIED conceptually against well-known Postgres MVCC semantics, but not tested against this project's actual Supabase-managed instance in this session]. |
| A3 | `Intl.DateTimeFormat` with `timeZone` correctly resolves `Asia/Almaty` (and any other IANA zone a user might set) on the owner's actual deployment target, not just the research sandbox | Don't Hand-Roll / Code Examples | Verified locally in this session's environment (Node process available via Bash), which uses the ICU data bundled with the installed Node binary. If the deployment target's Node build lacks full ICU (`small-icu` builds sometimes ship without full timezone data), the same code could silently misbehave. Node.js official pre-built binaries ship full ICU by default since Node 13 — risk is low but the planner should have the owner spot-check `node -e "console.log(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty'}).format(new Date()))"` on the actual deploy target once it's decided, not just locally. |

## Open Questions (RESOLVED)

> Both questions below were resolved during planning: the plans adopted each
> recommendation verbatim (04-01 for the schema shape, 04-02/04-06 for rounding).

1. **RESOLVED: Exact `diary_drafts` schema evolution shape** (explicitly left to the planner in
   CONTEXT.md's Claude's Discretion)
   - What we know: needs `awaiting_input` state (D-04: what input is expected, for which
     component, on which draft), `local_date` (D-07, frozen), a link to the `diary` row once
     confirmed (D-06).
   - What's unclear: whether `awaiting_input` is a single nullable jsonb column
     (`{kind: 'add_component' | 'typed_grams', componentIndex?: number}` or `null`) or two
     separate nullable columns; whether the `diary` link is `diary_drafts.diary_id` (nullable
     FK, set on confirm) or the reverse (`diary.draft_id` FK). D-06 says "a `diary` row is
     written with...a reference back to the draft," which points toward `diary.draft_id`, but
     D-06 also frames `diary_drafts` as the system of record that a UI edit re-enters — either
     direction works for querying, `diary.draft_id NOT NULL` reads slightly cleaner since every
     diary row necessarily has exactly one draft, and it means deleting a diary row (D-08) is a
     single-table DELETE with no need to null out a column on `diary_drafts` in the same
     transaction (that row is separately transitioned to `abandoned` per D-08 regardless).
   - Recommendation: `diary.draft_id integer not null references diary_drafts(id)`, plus
     `diary_drafts.diary_id integer references diary(id)` (nullable, set only on confirm) so
     both directions are queryable in O(1) without a join — slight denormalization, justified
     by D-06's "one correction code path" requirement needing to find "the draft for this
     diary row" starting from either object depending on which button was tapped.

2. **RESOLVED: Rounding display convention for the D-09 partial-total line**
   - What we know: the shape is `≥ 12 г (у 1 из 5 нет данных)`; components' individual grams
     are already `Math.round()`-ed for display in `result-card.ts`.
   - What's unclear: whether the total itself should round to the nearest integer or show one
     decimal place (calorie totals conventionally round to integers; protein/fat/carb/sugar
     grams in this codebase's existing UI (`result-card.ts`) are already integer-rounded per
     component).
   - Recommendation: round every displayed total to the nearest integer, consistent with the
     existing per-component display convention — store raw (unrounded) floats in
     `diary.kcal`/`proteinG`/etc. (the existing `real` column type already supports this), only
     round at render time, so Phase 5's diary views inherit precise stored numbers to sum
     across a week without compounding rounding error.

## Environment Availability

Skipped — this phase adds no new external tool/service/runtime dependency. It extends the
existing Postgres schema (via the already-working `drizzle-kit generate`/`migrate` flow) and
uses only already-installed npm packages plus a Node built-in (`Intl`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (already configured, `vitest.config.ts` at repo root) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/domain/nutrition src/application` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| CORRECT-01 | Card shows each component/grams/matched FDC record | unit (formatter) | `npx vitest run src/bot/formatting/correction-card.test.ts` | ❌ Wave 0 |
| CORRECT-02 | Confirm-as-is path produces a `diary` row | unit (application, fake db) | `npx vitest run src/application/confirm-meal.test.ts` | ❌ Wave 0 |
| CORRECT-03 | Swap candidate updates `chosenFdcId` and recomputed preview | unit | `npx vitest run src/application/corrections.test.ts -t swapCandidate` | ❌ Wave 0 |
| CORRECT-04 | ±10g buttons and typed-grams parsing, floor at >0 | unit | `npx vitest run src/application/corrections.test.ts -t adjustGrams` | ❌ Wave 0 |
| CORRECT-05 | Remove component; empty-state rule (D-12) | unit | `npx vitest run src/application/corrections.test.ts -t removeComponent` | ❌ Wave 0 |
| CORRECT-06 | Add component runs through `matchIngredient` (fake repo/embedder) | unit | `npx vitest run src/application/corrections.test.ts -t addComponent` | ❌ Wave 0 |
| CORRECT-07 | Draft state persists in Postgres, unaffected by process restart | unit (draft-store, no in-memory state asserted) + manual restart check | `npx vitest run src/application/draft-store.test.ts` | ❌ Wave 0 (extends existing file) |
| CORRECT-08 | Edit/delete a saved entry reuses correction mechanics | unit | `npx vitest run src/application/confirm-meal.test.ts -t editSaved` | ❌ Wave 0 |
| CALC-01 | Deterministic grams × per-100g math, no LLM in the path | unit (pure function, exhaustive cases) | `npx vitest run src/domain/nutrition/calculate-total.test.ts` | ❌ Wave 0 |
| CALC-02 / D-09 | Null-sugar (and any null nutrient) propagates as partial-total, never 0 | unit | `npx vitest run src/domain/nutrition/calculate-total.test.ts -t partial` | ❌ Wave 0 |
| DIARY-01 | Confirmed entry lands in the correct `local_date` (D-07 frozen-day regression case, Pitfall 4) | unit (fake clock) | `npx vitest run src/application/local-date.test.ts` | ❌ Wave 0 |
| D-04 (text routing gate) | Text handler defers to correction when `awaiting_input` is set | unit (handler-level, fake ctx) + registration-order test extending `bot.wiring.test.ts` | `npx vitest run src/bot/handlers/correction.test.ts src/bot/bot.wiring.test.ts` | ❌ Wave 0 |
| D-08 (hard delete) | Delete confirmation flow removes the `diary` row and marks draft `abandoned` | unit | `npx vitest run src/application/confirm-meal.test.ts -t delete` | ❌ Wave 0 |
| D-11 (24h expiry) | Stale draft blocks buttons with expiry copy | unit (fake clock) | `npx vitest run src/application/draft-store.test.ts -t expire` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/domain/nutrition src/application src/bot` (scoped
  to phase-touched directories, matches the Phase 1-3 pattern already used in this repo)
- **Per wave merge:** `npm test` (full suite) + `npx tsc --noEmit`
- **Phase gate:** Full suite green + manual Telegram walkthrough (this phase is UI-heavy;
  automated tests cover the pure logic, but the two-level card's actual look-and-feel on a
  real device needs a human pass, matching Phase 2's owner-sign-off precedent)

### Wave 0 Gaps
- [ ] `src/domain/nutrition/calculate-total.test.ts` — CALC-01/CALC-02/D-09
- [ ] `src/application/corrections.test.ts` — CORRECT-03..06
- [ ] `src/application/confirm-meal.test.ts` — CORRECT-02/08, D-08
- [ ] `src/application/local-date.test.ts` — DIARY-01, D-07/Pitfall 4
- [ ] `src/bot/formatting/correction-card.test.ts` — CORRECT-01, D-02/D-03/D-09 rendering
- [ ] `src/bot/handlers/correction.test.ts` — D-04 text-routing gate
- [ ] Extend `src/application/draft-store.test.ts` — CORRECT-07 persistence, D-11 expiry
- [ ] Extend `src/bot/bot.wiring.test.ts` — assert the new correction text-interceptor and
      callback handlers register at the correct point relative to the allowlist gate and
      Phase 3's `createTextHandler`
- No new framework install needed — Vitest is already fully configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Unchanged from Phase 2 (Telegram identity + allowlist gate, already enforced upstream of every handler this phase adds) |
| V3 Session Management | No | This phase's "session" (draft state) is already covered by V4/data-scoping below, not a login-session concern |
| V4 Access Control | Yes | Every draft/diary operation MUST scope by `userId` derived from `ctx.from.id` → `users.id`, never trust a `draftId` alone from callback_data as authorization — a callback handler must verify `draft.userId === resolvedUser.id` before applying any correction, or one allowlisted user could tamper with another's draft by guessing/observing a small integer id |
| V5 Input Validation | Yes | Typed-grams free text (must reject non-numeric/zero/negative), added-component text (length-bound like `MAX_TEXT_LENGTH` in Phase 3), `callback_data` regex parsing (reject anything not matching the exact expected shape rather than a loose parse) |
| V6 Cryptography | No | No new secrets/crypto surface in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Insecure direct object reference: tampering with another user's `diary_drafts`/`diary` row via a guessed/observed integer id in callback_data | Elevation of Privilege / Tampering | Every read in `application/corrections.ts`/`confirm-meal.ts` filters `WHERE id = $draftId AND user_id = $userId`, never `WHERE id = $draftId` alone — mirrors the existing pattern implicit in `findOnboardedUser`/`isDailyCapReached` scoping by `telegramId` |
| Replay/duplicate write via double-tap or retried callback_query | Tampering (data integrity) | Pitfall 3's conditional-update compare-and-swap for confirm/delete; idempotent handling elsewhere |
| Unbounded free-text input reaching the LLM-matching path for an added component | Denial of Service (cost) / Tampering | Bound added-component text length the same way `MAX_TEXT_LENGTH` bounds the Phase 3 text handler, before it reaches `matchIngredient`'s embedding call |
| Hard-delete of health data without confirmation | Repudiation / data-loss | D-08's confirm-before-delete step is the control; already locked by the discussion, this research only confirms it maps onto a real threat category (irreversible health-data loss from a stray tap) |

## Sources

### Primary (HIGH confidence)
- This repository's existing source (`src/application/types.ts`, `src/db/schema/diary-drafts.ts`,
  `src/db/schema/diary.ts`, `src/db/schema/users.ts`, `src/bot/bot.ts`, `src/bot/handlers/meal.ts`,
  `src/application/voice-pipeline.ts`, `src/bot/keyboards/onboarding-keyboards.ts`,
  `src/bot/telegram/ack.ts`, `src/domain/nutrition/*`) — read directly this session
- `.planning/phases/04-confirm-correct-diary-persistence/04-CONTEXT.md` — the locked decisions
  (D-01..D-12) this research is scoped by
- `.planning/phases/03-voice-pipeline/03-VERIFICATION.md`, `.planning/phases/03-voice-pipeline/03-CONTEXT.md`
  — confirms what Phase 3 actually shipped vs. what this phase can assume exists
- npm registry (`npm view grammy version`, `npm view @grammyjs/menu version dist-tags`) — run
  live this session, 2026-08-14
- Node `Intl.DateTimeFormat` timezone conversion — executed and verified directly in this
  session's environment against the exact `Asia/Almaty` case from D-07's motivating example

### Secondary (MEDIUM confidence)
- WebSearch: Telegram `callback_data` 64-byte limit and encoding practice, cross-referenced
  against grammY's own `InlineKeyboardButton`/`CallbackButton` reference pages
- WebSearch: Telegram Bot API `400: message is not modified` error — corroborated by multiple
  independent bug reports/community threads describing the identical failure mode

### Tertiary (LOW confidence)
- None used as load-bearing claims; anything WebSearch-only was cross-checked against a second
  source or this repository's own verified behavior before being stated as fact.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every choice traces to code already in this repo
  or a directly-verified Node built-in
- Architecture: HIGH for the callback-dispatch/state-machine pattern (grounded in this
  project's own established hexagonal conventions); MEDIUM for the exact `diary_drafts`
  schema shape (left as an Open Question per CONTEXT.md's explicit discretion grant)
- Pitfalls: HIGH for the Telegram-API-level pitfalls (message-not-modified, callback_data
  limit — both independently corroborated); MEDIUM for the concurrency/double-tap guidance
  (sound Postgres-standard reasoning, not tested against this project's live Supabase instance
  in this session)

**Research date:** 2026-08-14
**Valid until:** 2026-09-13 (30 days — grammY/Postgres/Telegram API mechanics are stable;
re-check if `@grammyjs/menu` or `grammy` majors bump before planning starts)
