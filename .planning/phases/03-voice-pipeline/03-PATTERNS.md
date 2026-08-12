# Phase 3: Voice pipeline - Pattern Map

**Mapped:** 2026-08-12
**Files analyzed:** 20 (new/modified)
**Analogs found:** 20 / 20

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/adapters/stt/types.ts` | port (type) | request-response | `src/adapters/embeddings/types.ts` | exact |
| `src/adapters/stt/openai-transcribe.ts` | adapter | request-response | `src/adapters/embeddings/openai-embed.ts` | exact |
| `src/adapters/stt/openai-transcribe.test.ts` | test | — | `src/adapters/embeddings/openai-embed.test.ts` | exact |
| `src/adapters/llm/types.ts` | port (type) | request-response | `src/adapters/embeddings/types.ts` + `src/domain/fdc-matching/types.ts` | role-match |
| `src/adapters/llm/openai-decompose.ts` | adapter | request-response | `src/adapters/embeddings/openai-embed.ts` (retry style) | role-match |
| `src/adapters/llm/openai-decompose.test.ts` | test | — | `src/adapters/embeddings/openai-embed.test.ts` | role-match |
| `src/application/voice-pipeline.ts` | service/orchestrator | event-driven | `src/domain/fdc-matching/match-ingredient.ts` (pure orchestration style) + `src/bot/onboarding/assemble-profile.ts` | partial-match (new layer) |
| `src/application/voice-pipeline.test.ts` | test | — | `src/domain/fdc-matching/match-ingredient.test.ts` | role-match |
| `src/application/idempotency.ts` | service | CRUD | `src/bot/storage/pg-storage-adapter.ts` (Drizzle write pattern) | role-match |
| `src/application/idempotency.test.ts` | test | — | `src/bot/storage/pg-storage-adapter.test.ts` | role-match |
| `src/bot/handlers/voice.ts` | handler | event-driven | `src/bot/commands/start.ts` + `src/bot/bot.ts` callbackQuery block (ack-then-detach) | role-match |
| `src/bot/handlers/text.ts` | handler | event-driven | `src/bot/commands/start.ts` | role-match |
| `src/bot/handlers/voice.test.ts` | test | — | `src/bot/commands/start.test.ts` | role-match |
| `src/bot/formatting/result-card.ts` | utility (pure formatting) | transform | `src/bot/formatting/onboarding-copy.ts` | exact |
| `src/bot/formatting/result-card.test.ts` | test | — | `src/bot/formatting/onboarding-copy.test.ts` | exact |
| `src/bot/telegram/download-voice.ts` | utility (Telegram I/O) | file-I/O | `src/bot/telegram/ack.ts` (structural-typing, swallow style) | role-match |
| `src/db/schema/processed-updates.ts` | model (table) | CRUD | `src/db/schema/bot-sessions.ts` | exact |
| `src/db/schema/diary-drafts.ts` | model (table) | CRUD | `src/db/schema/diary.ts` + `src/db/schema/bot-sessions.ts` | exact |
| `drizzle/000X_*.sql` (2 tables + RLS) | migration | batch | `drizzle/0004_bot_sessions_rls.sql` | exact |
| `scripts/verify-stt.ts` | script | request-response | `scripts/index-fdc/verify-matches.ts` | exact |
| `src/config/env.ts` (modified) | config | — | itself (extend `REQUIRED_ENV_KEYS`/`OPTIONAL_ENV_KEYS`) | exact |
| `.env.example` (modified) | config | — | itself | exact |
| `src/bot/bot.ts` (modified) | composition root | — | itself (extend registration order) | exact |

## Pattern Assignments

### `src/adapters/stt/types.ts` + `src/adapters/stt/openai-transcribe.ts` (adapter, request-response)

**Analog:** `src/adapters/embeddings/types.ts` + `src/adapters/embeddings/openai-embed.ts`

**Port shape** (`types.ts` file separate from impl file) — copy this exact split, `src/adapters/embeddings/types.ts` lines 47-53:
```typescript
export interface Embedder {
  /**
   * Returns one vector per input text, in the SAME order as `texts`.
   * `embed([])` must return `[]` and make zero API calls.
   */
  embed(texts: string[]): Promise<number[][]>;
}
```
Mirror this for `Transcriber`:
```typescript
// src/adapters/stt/types.ts
export const STT_MODEL = 'gpt-4o-mini-transcribe'; // D-03, single constant
export interface Transcriber {
  transcribe(audio: Buffer, opts?: { prompt?: string }): Promise<{ text: string; usage?: unknown }>;
}
```

**Client injection + fake-client seam** (`openai-embed.ts` lines 15-30):
```typescript
export interface OpenAILike {
  embeddings: {
    create(args: { model: string; input: string[]; dimensions?: number }): Promise<{
      data: { index: number; embedding: number[] }[];
    }>;
  };
}

export interface CreateOpenAIEmbedderOptions {
  apiKey?: string;
  client?: OpenAILike; // injectable for tests — no real client built, no network call possible
  batchSize?: number;
  maxRetries?: number;
}
```
For STT, define an `OpenAILike` scoped to `audio.transcriptions.create(...)` with the same `client?:` injection point on `createOpenAITranscriber(opts)`.

**Retry/backoff helper — copy verbatim, adapt to STT** (`openai-embed.ts` lines 32-121):
```typescript
const BACKOFF_MS = [1000, 2000, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ErrorLike { status?: number; code?: string | null; }

function asErrorLike(err: unknown): ErrorLike {
  if (err && typeof err === 'object') {
    const e = err as { status?: unknown; code?: unknown };
    return {
      status: typeof e.status === 'number' ? e.status : undefined,
      code: typeof e.code === 'string' ? e.code : undefined,
    };
  }
  return {};
}

function isRetryable(err: unknown): boolean {
  const { status, code } = asErrorLike(err);
  if (code === 'insufficient_quota') return false;
  if (status === 401) return false;
  if (status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  return false;
}

function toOwnerMessage(err: unknown): Error {
  const { status, code } = asErrorLike(err);
  const original = err instanceof Error ? err.message : String(err);
  if (code === 'insufficient_quota') {
    return new Error('на счету OpenAI закончились деньги — пополни баланс, см. план 01-02');
  }
  if (status === 401) {
    return new Error('проверь OPENAI_API_KEY в .env');
  }
  return err instanceof Error ? err : new Error(original);
}
```
This is the "existing retry/backoff helper" referenced in the phase context — reuse `isRetryable`/`toOwnerMessage`/`BACKOFF_MS`/`sleep` shape as-is for the STT adapter's single `transcribe()` call (no batching needed, so the `embedBatchWithRetry` loop collapses to one `attempt <= maxRetries` loop around `client.audio.transcriptions.create(...)`).

**`toFile()` upload pattern (STT-specific, not present in embeddings adapter)** — from RESEARCH.md Pattern 2, verified against installed `openai` 7.4.0 types:
```typescript
import OpenAI, { toFile } from 'openai';
const file = await toFile(audio, 'voice.ogg', { type: 'audio/ogg' });
const result = await client.audio.transcriptions.create({ file, model: STT_MODEL, prompt: opts?.prompt });
```

**Cost-estimate helper pattern** (`openai-embed.ts` lines 206-219, `estimateEmbeddingCostUsd`) — copy the shape (pure function, rough token/char heuristic, explicit `usdPerMillion` constant) for an equivalent `estimateTranscriptionCostUsd` used by both the pipeline's D-17 cost line and `verify-stt.ts`.

---

### `src/adapters/stt/openai-transcribe.test.ts` (test, fake-client pattern)

**Analog:** `src/adapters/embeddings/openai-embed.test.ts`

**Fake client factory pattern** (lines 9-24):
```typescript
function makeFakeClient(
  handler: (input: string[]) => Promise<{ data: { index: number; embedding: number[] }[] }>,
): { client: OpenAILike; calls: string[][]; requests: { model: string; dimensions?: number }[] } {
  const calls: string[][] = [];
  const requests: { model: string; dimensions?: number }[] = [];
  const client: OpenAILike = {
    embeddings: {
      create: async ({ input, model, dimensions }) => {
        calls.push(input);
        requests.push({ model, dimensions });
        return handler(input);
      },
    },
  };
  return { client, calls, requests };
}
```
Adapt to a `makeFakeTranscribeClient(handler)` returning `{ client: OpenAILike, calls: Buffer[] }` where `client.audio.transcriptions.create` records the call and returns a canned `{ text, usage }`.

**Retry-under-mocked-`setTimeout` pattern** (lines 165-188) — copy this exact `vi.spyOn(global, 'setTimeout')` trick so retry tests run instantly:
```typescript
vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
  fn();
  return 0 as unknown as NodeJS.Timeout;
}) as typeof setTimeout);
```

**Terminal-error assertions** (lines 190-208) — copy the two-case pattern: `insufficient_quota` → no retry, message contains "баланс"; `401` → no retry, message contains "OPENAI_API_KEY".

---

### `src/adapters/llm/types.ts` + `src/adapters/llm/openai-decompose.ts` (adapter, request-response)

**Analog (port shape):** `src/adapters/embeddings/types.ts` (constant-plus-interface file) and `src/domain/fdc-matching/types.ts` (interface + defensive port comment style)

**Analog (retry structure — NoObjectGeneratedError is DIFFERENT from the embeddings retry, do not reuse `isRetryable`/backoff here):** RESEARCH.md Pattern 3, already a full verified code sketch — implement as written:
```typescript
import { generateObject, NoObjectGeneratedError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { loadEnv } from '../../config/env.js';

export const DECOMPOSITION_MODEL = 'gpt-4o-mini'; // D-16, single constant, Claude's-discretion default

const ComponentSchema = z.object({
  component: z.string().min(1),
  component_en: z.string().min(1),
  grams: z.number().positive().max(2000), // .nullable() not .optional() if ever made absent-able — OpenAI strict mode gotcha
});

export const DecompositionSchema = z.object({
  items: z.array(ComponentSchema), // empty array is VALID — D-08, not a retry trigger
});

export type Decomposition = z.infer<typeof DecompositionSchema>;

export interface DishDecomposer {
  decompose(transcript: string): Promise<Decomposition>;
}
```
**Retry-on-schema-invalid only** (do not confuse with the AI SDK's own `maxRetries`, see Pitfall 5 in RESEARCH.md):
```typescript
try {
  const result = await attempt(transcript, false);
  return result.object; // may legitimately be { items: [] } — D-08
} catch (err) {
  if (NoObjectGeneratedError.isInstance(err)) {
    try {
      const retryResult = await attempt(transcript, true);
      return retryResult.object;
    } catch (retryErr) {
      if (NoObjectGeneratedError.isInstance(retryErr)) {
        throw new Error('DECOMPOSITION_FAILED');
      }
      throw retryErr;
    }
  }
  throw err;
}
```

**Owner-readable error message convention** — reuse `toOwnerMessage`-style mapping (see STT adapter above) for network/auth failures surfaced by `generateObject`, keeping the Russian-actionable-message house style.

---

### `src/adapters/llm/openai-decompose.test.ts` (test, fake-decomposer pattern)

**Analog:** `src/adapters/embeddings/openai-embed.test.ts` (fake-client factory shape) + RESEARCH.md's Wave-0 test map for DECOMP-01/02/03

Cases to copy the shape of, one `it()` per case (mirrors the embeddings test file's one-behavior-per-test style):
- well-formed multi-item response validates (DECOMP-01)
- single-ingredient input yields exactly one component, not split (DECOMP-02, pipeline-level contract — belongs more precisely to `voice-pipeline.test.ts` per RESEARCH.md's test map, but the schema-level single-item case still belongs here)
- `NoObjectGeneratedError` thrown once, then succeeds on manual retry (DECOMP-03)
- `NoObjectGeneratedError` thrown twice → `DECOMPOSITION_FAILED` (DECOMP-03 terminal)
- well-formed `{ items: [] }` returns cleanly, no retry call made (D-08 carve-out) — assert the fake decomposer's `attempt` was called exactly once

---

### `src/application/voice-pipeline.ts` (orchestrator, event-driven)

**Analog (pure-orchestration style, zero grammY):** `src/domain/fdc-matching/match-ingredient.ts` — copy its shape: typed `Args` interface, explicit validation before expensive calls, no I/O of its own beyond the injected ports.

**Analog (dependency-injection-of-ports style):** `MatchIngredientArgs` (lines 22-27) — model `ProcessVoiceOrTextArgs` the same way: pass `db`, `transcriber`, `decomposer`, `embedder`, `repo` explicitly, never construct them internally (matches ARCHITECTURE.md Pattern 3 already enforced here).

**Analog (parallel embed+match, not sequential — Pitfall 2 in RESEARCH.md):**
```typescript
// one batched embed() call across all component_en names, THEN parallel matchIngredient() calls
const vectors = await embedder.embed(items.map((i) => i.component_en));
const matched = await Promise.all(vectors.map((v) => matchIngredient({ embedding: v, repo })));
```

**Never import grammY** — matches the hexagonal rule already stated in `match-ingredient.ts`'s module doc comment ("imports NOTHING outside itself... no drizzle, no postgres, no openai" for the *domain* layer; `application/` is allowed adapters/db but never grammY types, per CONTEXT.md's Architectural Responsibility Map).

---

### `src/application/idempotency.ts` (service, CRUD)

**Analog:** `src/bot/storage/pg-storage-adapter.ts` (Drizzle read/write against a keyed Postgres table) — read this file's exact upsert/read shape before implementing; also directly usable as RESEARCH.md's own Pattern 4 code (already a complete, implementable sketch):
```typescript
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { processedUpdates } from '../db/schema/processed-updates.js';

export async function claimUpdate(db: Db, updateId: number): Promise<boolean> {
  const rows = await db
    .insert(processedUpdates)
    .values({ updateId, status: 'processing' })
    .onConflictDoNothing({ target: processedUpdates.updateId })
    .returning({ updateId: processedUpdates.updateId });
  return rows.length > 0;
}

export async function markUpdateDone(db: Db, updateId: number): Promise<void> {
  await db.update(processedUpdates).set({ status: 'done' }).where(eq(processedUpdates.updateId, updateId));
}
```

---

### `src/bot/handlers/voice.ts` + `src/bot/handlers/text.ts` (handler, event-driven)

**Analog (handler shape, DB read + ctx.reply, no ctx.session use):** `src/bot/commands/start.ts` lines 62-80 — copy the closure-over-`db` factory pattern (`createStartHandler(db)` returning `async (ctx: BotContext) => {...}`), not a bare top-level function, so the handler stays injectable/testable exactly like `createStartHandler`.

**Analog (ack-then-detach registration, swallow-stale pattern):** `src/bot/bot.ts` lines 102-109 (the `RESTART_ONBOARDING_CALLBACK` handler) for the `ack()`-first idiom, combined with RESEARCH.md Pattern 5's full sketch (already implementable):
```typescript
bot.on('message:voice', async (ctx) => {
  if (!(await claimUpdate(db, ctx.update.update_id))) return;

  let buffer: Buffer;
  try {
    buffer = await downloadVoice(ctx, deps.token);
  } catch (err) {
    if (err instanceof VoiceTooLongError) {
      await ctx.reply('Голосовое слишком длинное — до 60 секунд.');
    } else {
      await ctx.reply('Не смог скачать голосовое, попробуй ещё раз.');
    }
    return;
  }

  const ack = await ctx.reply('Секунду, разбираю 🎧');

  void processVoiceOrText({ db, buffer, chatId: ctx.chat.id, ackMessageId: ack.message_id })
    .catch((err) => console.error(`ошибка обработки update_id=${ctx.update.update_id}:`, describeError(err)));
});
```

**Analog (never log the token / never log ctx):** `src/bot/error-handler.ts` module doc comment (lines 11-18) — the same invariant applies to any `console.error` inside `voice.ts`/`text.ts`/`download-voice.ts`: never log `ctx`, the file-download URL (embeds the bot token), or transcript text — only counts/status/error kind.

**Registration point:** `src/bot/bot.ts` — new handlers register in section "5. Handlers", **after** the allowlist gate (already first) and after session/conversations middleware, mirroring where `bot.command('whoami', ...)`/`bot.command('start', ...)` sit today (lines 93-101). Extend `bot.wiring.test.ts`'s existing `indexOf`-ordering assertions (lines 24-38) to also assert the new voice/text handler registration comes after `createAllowlistMiddleware`.

---

### `src/bot/handlers/voice.test.ts` (test)

**Analog:** `src/bot/commands/start.test.ts` — read this for the fake-`ctx`/fake-`db` construction pattern already established for handler unit tests (structural typing over `BotContext`, no real grammY `Bot` instance, no real DB).

---

### `src/bot/formatting/result-card.ts` (pure formatting, transform)

**Analog:** `src/bot/formatting/onboarding-copy.ts` — copy its house style exactly:
- Zero grammY imports (module doc comment lines 9-11: "this module only returns strings, it never touches a Telegram ctx").
- Pure functions taking typed domain data, returning a Russian string built via `[...].join('\n')`.
- "State the fact, then state what to do" voice.

```typescript
export function buildExistingTargetsMessage(user: OnboardedUserRow): string {
  return [
    'С возвращением! Вот твои текущие цели:',
    `Калории: ${user.targetKcal} ккал`,
    ...
  ].join('\n');
}
```
For the result card (D-18/D-20/D-21): no КБЖУ numbers (D-20), each component shows name/grams/matched FDC description, and a weak-match line uses the same "state the fact" idiom, e.g. append `'⚠ совпадение слабое, проверь'` per flagged component — never drop a component (D-21).

---

### `src/bot/formatting/result-card.test.ts` (test)

**Analog:** `src/bot/formatting/onboarding-copy.test.ts` — pure-function assertions on returned string content (`toContain`/`toMatch`), no mocking needed since the module has zero I/O.

---

### `src/bot/telegram/download-voice.ts` (utility, file-I/O)

**Analog:** `src/bot/telegram/ack.ts` — copy its two conventions:
1. Structural-typing the input (`AnswerableCallbackQuery`) rather than importing `Context`, so the helper is unit-testable with a two-line fake. Apply the same to `downloadVoice(ctx, token)`'s `ctx` parameter if feasible, or accept the narrowest grammY type actually needed.
2. Extensive module doc comment explaining *why* the function behaves the way it does (here: why D-05 forbids `fs.writeFile`, why the token-bearing URL must never be logged) — matches `ack.ts`'s doc-comment depth.

RESEARCH.md Pattern 1 (lines 233-274) is already a complete, directly implementable code example for this file — use as the primary source instead of re-deriving from `ack.ts`.

---

### `src/db/schema/processed-updates.ts` (model, CRUD)

**Analog:** `src/db/schema/bot-sessions.ts` — copy the file's structure: module doc comment explaining *why* the table exists and its RLS rationale, `pgTable(...)` call, exported `Row`/`NewRow` inferred types:
```typescript
export type BotSessionRow = typeof botSessions.$inferSelect;
export type NewBotSessionRow = typeof botSessions.$inferInsert;
```
Concrete columns per RESEARCH.md's schema sketch (lines 536-550):
```typescript
import { bigint, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const processedUpdates = pgTable('processed_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  status: text('status').notNull().$type<'processing' | 'done' | 'interrupted' | 'failed'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
```

---

### `src/db/schema/diary-drafts.ts` (model, CRUD)

**Analog:** `src/db/schema/diary.ts` (nullable-nutrient convention, `references(() => users.id, { onDelete: 'cascade' })`, `index(...)` on a hot lookup column) + `src/db/schema/bot-sessions.ts` (jsonb blob + RLS rationale doc comment).
RESEARCH.md's schema sketch (lines 514-533) is a complete draft:
```typescript
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const diaryDrafts = pgTable('diary_drafts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull(),
  messageId: integer('message_id').notNull(), // the ack message D-13 edits in place
  transcript: text('transcript').notNull(),
  components: jsonb('components').notNull(),
  status: text('status').notNull().$type<'draft' | 'confirmed' | 'abandoned'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

---

### `drizzle/000X_*.sql` migrations for both new tables (migration, batch)

**Analog:** `drizzle/0004_bot_sessions_rls.sql` — copy verbatim, substituting the table name:
```sql
ALTER TABLE "processed_updates" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "processed_updates" FROM anon, authenticated;
  END IF;
END $$;
```
Repeat for `diary_drafts`. Generate the base table-creation migration via `npm run db:generate` (never hand-write it, never `db:push` — locked by Phase 1), then hand-write the RLS follow-up migration in the same style as `0004_bot_sessions_rls.sql`, and run `npm run db:migrate` only after the owner reviews the generated SQL (per CONTEXT.md D-19/Claude's Discretion and the Phase 1 migration workflow lock).

---

### `scripts/verify-stt.ts` (script, request-response)

**Analog:** `scripts/index-fdc/verify-matches.ts` — copy its full house style:
- Module doc comment stating which phase success criterion this satisfies and what it runs (lines 1-17).
- `argvHas('--json')` flag support (lines 54-56).
- Collect `Failure[]` (`{ message, remediation }`) rather than throwing immediately, so one bad sample doesn't abort the whole run (lines 49-53, 106-130).
- Plain-Russian block-per-item printing function (`printBlock`, lines 62-84) — adapt to print both models' transcripts side by side per D-04.
- Final summary: `OK` line on success, or numbered `failures` with remediation text on failure (lines 174-191).
- `process.exit(ok ? 0 : 1)` (line 191) so this is CI/npm-script friendly.
- Top-level `main().catch(...)` guard (lines 194-197).
- Cost line reuses `estimateEmbeddingCostUsd`'s shape (line 93, 96) — add an equivalent `estimateTranscriptionCostUsd` from the STT adapter file and print it per D-04/D-17.
- **Do not** touch Telegram or the Postgres `processed_updates`/draft tables — D-04 is explicit that this is "not part of the bot process, no Telegram involved"; only reads local files from a gitignored `samples/` folder and calls OpenAI directly.

**npm script wiring** — add to `package.json`'s `"scripts"` block alongside the existing `verify-*` entries:
```json
"verify-stt": "tsx scripts/verify-stt.ts"
```

---

### `src/config/env.ts` + `.env.example` (config, modified)

**Analog:** itself — extend, don't restructure.

Add to `REQUIRED_ENV_KEYS` (env.ts line 8) only if a new key is truly required to start the bot (likely none — `OPENAI_API_KEY`/`TELEGRAM_BOT_TOKEN`/`DATABASE_URL` already cover STT/LLM/DB). If a new optional constant-override env var is introduced (e.g. an `STT_MODEL`/`DECOMPOSITION_MODEL` override, or a `MAX_VOICE_SECONDS`/`DAILY_MESSAGE_CAP` override), add it to `OPTIONAL_ENV_KEYS` (line 24) — **not** `REQUIRED_ENV_KEYS`, since D-03/D-16 already lock these as code constants, not required config; only add an env override if genuinely useful for owner tuning without a redeploy.

Every new key added to either array **must** also get a documented block in `.env.example`, matching the existing four-key style (comment explaining "where to get it" / "what happens if empty", then the `KEY=` line) — `env.test.ts` asserts `REQUIRED_ENV_KEYS`/`OPTIONAL_ENV_KEYS` stay in sync with `.env.example`'s declared keys.

---

### `src/bot/bot.ts` (composition root, modified)

**Analog:** itself. Extend section "5. Handlers" (lines 93-101) to register `bot.on('message:voice', voiceHandler)` and `bot.on('message:text', textHandler)` **after** `bot.command('whoami', ...)`/`bot.command('start', ...)` and **after** the allowlist/session/conversations middleware chain (steps 1-4, unchanged) — never before. Update the module doc comment's registration-order description (currently "allowlist -> session -> conversations -> conversation -> commands", lines 14-15) to mention voice/text handlers land in the same final tier as commands. Extend `bot.wiring.test.ts` with a new assertion following the existing `indexOf` pattern (lines 24-38) confirming the voice/text handler registration text appears after `createAllowlistMiddleware`.

## Shared Patterns

### Hexagonal port/adapter shape (type file + impl file, injectable client)
**Source:** `src/adapters/embeddings/types.ts` + `src/adapters/embeddings/openai-embed.ts`, `src/domain/fdc-matching/types.ts` + `match-ingredient.ts`
**Apply to:** `src/adapters/stt/*`, `src/adapters/llm/*`
- One `types.ts` with the port `interface` + any shared constants (model name, dimensions/thresholds).
- One `<provider>-<verb>.ts` with the concrete adapter, an `<Provider>Like` structural interface for the SDK surface actually used, and a `Create<X>Options` with an injectable `client?:` for tests.
- Adapter reads secrets via `loadEnv()` lazily inside a `getClient()`/factory closure, never at module import time.

### Retry/backoff for OpenAI calls (raw `openai` client)
**Source:** `src/adapters/embeddings/openai-embed.ts` lines 32-121 (`BACKOFF_MS`, `isRetryable`, `toOwnerMessage`, `sleep`)
**Apply to:** `src/adapters/stt/openai-transcribe.ts` (reuse verbatim shape — same SDK, same error surface)
**Do NOT apply to:** `src/adapters/llm/openai-decompose.ts` — the `ai` SDK's `generateObject` already retries transient failures internally (`maxRetries`, default 2); only wrap `NoObjectGeneratedError` there, per RESEARCH.md Pitfall 5.

### Never log secrets or health data
**Source:** `src/bot/error-handler.ts` module doc comment (lines 11-18), `src/adapters/embeddings/openai-embed.ts` line 8-9 ("Never logs the API key or the embedded text")
**Apply to:** all new adapters, handlers, `application/voice-pipeline.ts`, `download-voice.ts` — never log `ctx`, the file-download URL (bot token embedded), transcript text, or raw audio; log only counts, status, error kind.

### Russian, actionable operator/user messages
**Source:** `src/config/env.ts` `buildMissingKeysMessage`, `openai-embed.ts` `toOwnerMessage`, `scripts/index-fdc/verify-matches.ts` failure/remediation pairs
**Apply to:** every new user-facing bot reply and every `verify-stt.ts` failure line — state the fact, then state what to do, in Russian.

### Drizzle table file convention
**Source:** `src/db/schema/bot-sessions.ts`, `src/db/schema/diary.ts`
**Apply to:** `src/db/schema/processed-updates.ts`, `src/db/schema/diary-drafts.ts`
- Module doc comment explaining why the table exists and its RLS rationale.
- Export `pgTable(...)` plus inferred `Row`/`NewRow` types.
- One table per file.

### RLS migration
**Source:** `drizzle/0004_bot_sessions_rls.sql`
**Apply to:** both new tables — `ENABLE ROW LEVEL SECURITY` + guarded `REVOKE ALL ... FROM anon, authenticated` if the role exists, as a separate hand-written migration following the generated table-creation migration.

### `verify-*` script house style
**Source:** `scripts/index-fdc/verify-matches.ts`, also `scripts/verify-schema.ts`
**Apply to:** `scripts/verify-stt.ts`
Plain-Russian output, `--json` flag, collected `{message, remediation}` failures rather than early throw, `process.exit(ok ? 0 : 1)`, wired as an `npm run verify-stt` script.

### bot.ts registration order is load-bearing
**Source:** `src/bot/bot.ts` + `src/bot/bot.wiring.test.ts`
**Apply to:** new voice/text handler registration — must land after the allowlist gate (and after session/conversations middleware, consistent with existing commands); extend `bot.wiring.test.ts`'s `indexOf` assertions rather than adding an untested ordering assumption.

## No Analog Found

None — every file in this phase has a strong (exact or role-match) existing analog in the Phase 1/2 codebase; no file requires inventing a pattern from RESEARCH.md alone. `src/application/` is a genuinely new directory (no Phase 1/2 precedent for an orchestration layer), but its required shape (pure, port-injected, zero-transport-import) is fully specified by the existing hexagonal convention in `src/domain/fdc-matching/` plus RESEARCH.md's own complete code sketches (Patterns 1-5), so it is not treated as a gap.

## Metadata

**Analog search scope:** `src/adapters/`, `src/domain/`, `src/bot/`, `src/db/schema/`, `src/config/`, `scripts/`, `drizzle/`
**Files scanned:** ~70 (full `src/`+`scripts/` TypeScript file listing) plus 15 read in full for pattern extraction
**Pattern extraction date:** 2026-08-12
