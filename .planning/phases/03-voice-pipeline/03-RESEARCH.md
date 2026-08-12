# Phase 3: Voice pipeline - Research

**Researched:** 2026-08-12
**Domain:** Telegram voice/text ingestion → OpenAI STT → Vercel AI SDK structured-output LLM decomposition → runtime FDC embedding matching, wired idempotently on grammY long polling
**Confidence:** HIGH for library call shapes (verified against installed `node_modules` + Context7 + npm registry) / MEDIUM for exact OpenAI transcription cost figures (aggregator-sourced, not fetched directly from platform.openai.com/pricing this session) / HIGH for idempotency, hexagonal, and draft-persistence patterns (directly extend Phase 1/2's already-shipped code)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Speech-to-text**
- D-01: Beta users speak Russian with Kazakh dish names in it — not full Kazakh sentences. This is a rare-vocabulary + decomposition problem, not a Kazakh-STT problem. Full-Kazakh speech is out of scope for the beta.
- D-02: OpenAI is the STT provider for Phase 3, reached through a `Transcriber` port (hexagonal, matching `Embedder`/`FdcRepository`). Yandex SpeechKit is deferred, not rejected — a one-adapter swap if D-01 is wrong.
- D-03: Model is `gpt-4o-mini-transcribe`, held in a single constant/env var. Owner deliberately overrode the cheaper-is-not-obviously-better recommendation; `verify-stt` (D-04) must transcribe each sample with **both** `gpt-4o-mini-transcribe` and `gpt-4o-transcribe` side by side so the choice is settled empirically.
- D-04: Success criterion 2 is satisfied by `npm run verify-stt` — plain-Russian output, ~10 owner-supplied voice files from a **gitignored** folder, prints transcript + estimated cost per model. Not part of the bot process, no Telegram involved.
- D-05: Audio is never written to disk and never logged. Streamed from Telegram into memory, handed to STT, dropped. The **transcript is persisted**.
- D-06: Accepted input is `voice` messages and plain `text` only (VOICE-01, VOICE-04). `audio`, `video_note`, photos, documents, stickers get a short polite Russian refusal, cost nothing.
- D-07: No STT prompt glossary yet — the adapter exposes an optional `prompt` seam, starts empty.
- D-08: "No food in the message" is a normal answer, not a failure. Empty `items` list on a well-formed LLM response → Russian "не услышал еды" reply, **no** retry spent. This is distinct from DECOMP-03's malformed-output retry. No pre-LLM length heuristic.

**Run mode, idempotency, in-flight UX**
- D-09: Phase 3 stays on grammY **long polling on the owner's machine** — revises Phase 2's D-02 (which expected webhook hosting here). The `createBot()` seam stays untouched.
- D-10: Idempotency via a `processed_updates` table keyed on Telegram `update_id`. Row inserted **before any paid call**; unique-key conflict = "already handled," handler returns silently. Works unchanged under webhook later.
- D-11: The row carries a status. On startup, rows still `processing` (crash/restart fingerprint) get the affected user told "analysis was interrupted, send again" — no auto-resume (audio is gone by design, D-05).
- D-12: Three voice messages in a row are all processed — no per-user in-process queue.
- D-13: One message, edited in place. "Секунду, разбираю 🎧" sent once; edited into the result when done. Stable `message_id` for Phase 4's keyboard.

**Cost control**
- D-14: Audio capped at 60 seconds, checked against the update's `duration` field **before** download and before any paid call.
- D-15: Soft per-user cap of ~30 processed messages/day — a runaway guard, not a tariff.
- D-16: Decomposition runs through the Vercel AI SDK (`generateObject` + Zod) against OpenAI — same account/spend cap as STT and embeddings. Model name lives in a constant.
- D-17: One cost line per processed message in the terminal — STT seconds, LLM tokens, embedding count, estimated dollars. No spend table, no dashboard.

**What the phase produces**
- D-18: Result is a read-only text card, no inline keyboard — same content Phase 4's card will show (component, grams, matched FDC record). Not all 3 candidates + scores (reads as a debug dump).
- D-19: The draft **is** persisted to Postgres in Phase 3 (transcript, components with grams, matched candidates). Phase 4 owns further schema evolution.
- D-20: No КБЖУ numbers in the Phase 3 card — nutrient arithmetic is CALC-01 (Phase 4).
- D-21: A weak FDC match is shown, flagged ("совпадение слабое, проверь"), never silently dropped.

### Claude's Discretion
- The decomposition prompt itself, including composite Central Asian dishes (бешбармак, куырдак, плов, манты) → FDC-findable ingredients, and explicit stated weight ("200 г риса") overriding the model's estimate. Treat as the single biggest accuracy lever; put expectations in tests, not prose.
- The DECOMP-03 retry: one retry with a stricter prompt on schema-invalid output, then "не смог разобрать, опиши иначе." D-08 carve-out applies (well-formed empty ≠ retry trigger).
- Retry/backoff for transient network/429 failures from OpenAI, and Russian text for each terminal failure mode.
- Embedding calls for components — batching, caching. Hard constraint: runtime embedding **must** use `text-embedding-3-large` truncated to 1536 dims (01-CONTEXT D-02 as amended) — the exact model/dimension the index was built with.
- File layout under `src/application/`, `src/adapters/stt/`, `src/adapters/llm/`, `src/bot/handlers/`, plus Drizzle migrations for `processed_updates` and the draft table. Migration workflow locked: `drizzle-kit generate` + `migrate` only, `push` banned, owner reviews SQL before `db:migrate`.
- Test strategy: pure logic (schema validation, gram parsing, card formatting, limit checks, idempotency decision function) unit-tested with Vitest against fakes; anything touching a real API verified by a `verify-*` script or by hand.

### Deferred Ideas (OUT OF SCOPE)
- `verify-pipeline` script (audio → transcript → components → candidates in one report) — offered, not taken; revisit in Phase 4.
- Yandex SpeechKit adapter — blocked on D-01 being wrong.
- Kazakh dish-name glossary in the STT prompt — seam exists (D-07), stays empty until `verify-stt` shows real misrecognitions.
- Deployment to a hosting provider + `setWebhook` — deferred again (D-09).
- Persisted spend ledger / unit economics per user — Phase 3 only prints a per-message cost line (D-17).
- Per-user message limits as a subscription tariff — D-15 is a runaway guard only.
- BullMQ/Redis job queue — build the `enqueue`/`process` seam, not the queue.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-01 | User can send a voice message describing a meal | grammY `ctx.message.voice` + `ctx.getFile()` pattern (Architecture Patterns → In-Memory Voice Download); D-06 content-type gate |
| VOICE-02 | Bot instantly acknowledges ("Секунду, разбираю") while processing continues | Ack-first + edit-in-place pattern (Architecture Patterns → Pattern 1/D-13); `sendMessage` then `editMessageText`, never awaited inline in the update handler |
| VOICE-03 | Voice → text via STT (RU/KZ) | `openai.audio.transcriptions.create` with `gpt-4o-mini-transcribe`/`gpt-4o-transcribe`, `toFile()` from an in-memory Buffer (Code Examples → STT adapter) |
| VOICE-04 | User can send typed text instead, same downstream pipeline | Single `TranscriptResult`-shaped seam consumed by both the voice handler and the text handler (Architecture Patterns → Recommended Project Structure) |
| DECOMP-01 | LLM decomposes text into components with English names + gram estimates | `generateObject()` + Zod schema against OpenAI (Code Examples → Decomposition adapter) |
| DECOMP-02 | Single-ingredient dish → one component, not artificially split | Prompt design guidance (Common Pitfalls → Pitfall: over-decomposition) + test-driven prompt contract (Claude's Discretion) |
| DECOMP-03 | Schema validation; invalid/empty → one retry, then graceful failure message | `NoObjectGeneratedError` catch + one manual re-call with a stricter prompt (Code Examples → Decomposition adapter retry loop); D-08 carve-out for well-formed-empty |
</phase_requirements>

## Summary

Phase 3 wires four already-isolated pieces — grammY's update loop, OpenAI's transcription endpoint, the Vercel AI SDK's structured-output call, and Phase 1's `matchIngredient`/`Embedder` ports — into one idempotent, ack-first pipeline. None of the individual library calls are exotic: `openai.audio.transcriptions.create()` takes an in-memory `File` built via the SDK's own `toFile()` helper (Buffer in, no disk write, satisfying D-05); `generateObject()` from `ai` + a Zod schema is the same pattern Phase 1/STACK.md already specified, and OpenAI's structured-output mode is strict-by-default in the currently-installed `@ai-sdk/openai` (nullable fields required, not `.optional()`/`.nullish()` — a real gotcha for this project's "grams can be inferred as absent" case, addressed below). The two genuinely new architectural pieces this phase must build correctly are (1) an idempotency gate (`processed_updates`, insert-before-paid-call, `onConflictDoNothing().returning()`) and (2) the ack-then-edit UX (`ctx.reply()` now, `ctx.api.editMessageText()` later, off the synchronous handler path) — both are extensions of patterns Phase 2 already uses (Postgres-backed session storage, `ack()` swallow-on-stale-callback) rather than new library territory.

No new infrastructure is required: no queue, no Redis, no webhook, no new cloud account. Every dependency this phase needs (`openai`, and newly `ai` + `@ai-sdk/openai` + `zod`) either is already installed or resolves to versions already pinned in `package.json`/STACK.md. The dominant risk in this phase is not "will the library calls work" (they will, verified below) — it is prompt-design accuracy for composite Central Asian dishes and disciplined field-level validation on LLM output, both of which are Claude's-discretion items this research flags with test-first guidance rather than prescribing a fixed prompt.

**Primary recommendation:** Build three narrow adapters (`Transcriber`, `DishDecomposer`, reuse existing `Embedder`) behind the same hexagonal port style as Phase 1, orchestrate them from a single `processVoiceOrText()` function in `src/application/voice-pipeline.ts` that never imports grammY, and gate every entry into that function on a `processed_updates` row insert — in that order, nothing else in this phase is architecturally novel.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Voice/text message intake, content-type gating (D-06) | Bot layer (`src/bot/handlers/`) | — | Only place grammY `ctx`/`Context.message` types may appear (established hexagonal rule) |
| Immediate ack + later edit (D-13) | Bot layer | Application (triggers the edit after pipeline completion) | Sending/editing Telegram messages is Bot-API I/O, but *when* to edit is driven by pipeline completion, decided in `application/` |
| Idempotency gate (`processed_updates`, D-10/D-11) | Application (`src/application/voice-pipeline.ts`) | Database (unique constraint enforces it) | The decision "already handled, skip" is orchestration logic; Postgres's unique index is the enforcement backstop, not the decision-maker |
| Audio download into memory (D-05) | Bot layer | — | `ctx.getFile()`/fetch is Telegram-API-specific; the resulting `Buffer` is what crosses into `application/` |
| STT transcription | Adapter (`src/adapters/stt/`) | — | External API call behind a `Transcriber` port, per D-02 |
| LLM decomposition + validation (DECOMP-01..03) | Adapter (`src/adapters/llm/`) | Domain (Zod schema *is* the validator, arguably domain-adjacent but implemented at the adapter boundary per existing `Embedder`/`FdcRepository` precedent) | Matches how `openai-embed.ts` already wraps OpenAI; the Zod schema is the contract, enforced right where the API is called |
| Runtime component embedding | Adapter (existing `src/adapters/embeddings/openai-embed.ts`, reused) | — | Zero new code — Phase 1's `Embedder` port is the only entry point; must use `text-embedding-3-large`@1536 |
| Per-component FDC matching | Domain (existing `src/domain/fdc-matching`, reused) | Adapter (`src/adapters/fdc-repository.ts`, reused) | Zero new code — `matchIngredient()` is the only entry point, per its own barrel comment |
| Draft persistence (D-19) | Database (new table, Drizzle migration) | Application (writes the row) | Schema lives in `src/db/schema/`; the write is orchestrated from `application/` after matching completes |
| Read-only result card formatting (D-18/D-20/D-21) | Bot layer (`src/bot/formatting/`) | — | Pure string formatting from typed draft data, no I/O — same pattern as `onboarding-copy.ts` |
| Cost accounting line (D-17) | Application or a small `src/adapters/cost-log.ts` | — | Reads `usage`/`duration` fields already returned by the STT/LLM/embedding calls; pure computation + `console.log`, no persistence |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `openai` | 7.4.0 (installed, verified `npm view openai version` → 7.4.0 current) | STT (`audio.transcriptions.create`), reused for runtime embeddings | Already the project's OpenAI SDK (Phase 1); one client for STT + embeddings keeps one account/spend cap in play, per D-02 |
| `ai` | **7.0.62** [VERIFIED: npm registry, `npm view ai version`/`versions`] | `generateObject()` for LLM decomposition (D-16) | Not yet installed — must be added this phase. STACK.md's "7.0.x" recommendation is current; do not install `6.x` or `5.x` — those are prior majors still on npm dist-tags (`ai-v6`, `ai-v5`) but `latest` resolves to 7.0.62 |
| `@ai-sdk/openai` | **4.0.40** [VERIFIED: npm registry] | AI SDK's OpenAI provider (model resolution for `generateObject`) | Confirms STACK.md's version-non-parity warning: core `ai` is major 7, `@ai-sdk/openai` is major 4 — resolve independently, never assume matching majors |
| `zod` | **4.4.3** [VERIFIED: npm registry] | Decomposition schema — both the runtime validator and the TS type | Not yet installed. Zod v4 default import path is just `zod` (no `zod/v4` needed at this version) — confirm at implementation time against whichever exact patch lands |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-orm` | 0.45.2 (installed) | `processed_updates` + draft table schema/queries, `onConflictDoNothing().returning()` idempotency pattern | Already the project's ORM — no new library needed for idempotency, just a new migration |
| `drizzle-kit` | 0.31.10 (installed) | `db:generate` + `db:migrate` — the only sanctioned migration path (locked by Phase 1) | Two new tables this phase: `processed_updates`, draft table (name TBD, e.g. `diary_drafts`) |
| `vitest` | 4.1.10 (installed) | Unit tests for schema validation, gram-bound checks, card formatting, idempotency decision function, limit checks | House style since Phase 1 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ai` SDK `generateObject` | Calling `openai.chat.completions.create({ response_format: { type: 'json_schema', strict: true } })` directly | Loses provider portability (STACK.md's stated reason for the AI SDK); marginally fewer moving parts. Not recommended — D-16 already locks this in |
| `gpt-4o-mini-transcribe` (D-03, locked) | `gpt-4o-transcribe` | ~$0.0005/message more expensive at ~10s messages, but documented to handle rare vocabulary (Kazakh dish names) better. `verify-stt` settles this empirically per D-04 — do not silently swap |
| In-process `processed_updates` idempotency | BullMQ job IDs | Explicitly reconciled against in Roadmap/SUMMARY.md — not for v1 |

**Installation:**
```bash
npm install ai@7.0.62 @ai-sdk/openai@4.0.40 zod@4.4.3
```

**Version verification:** Re-run before implementation, since these move fast:
```bash
npm view ai version
npm view @ai-sdk/openai version
npm view zod version
```
All three verified live against the npm registry on 2026-08-12 (this research session) — HIGH confidence, but re-check at plan-execution time per house convention (Phase 1's stack table did the same).

## Architecture Patterns

### System Architecture Diagram

```
Telegram user
    │ sends voice OR text message
    ▼
grammY long-polling loop (src/bot/bot.ts, allowlist gate already in front)
    │
    ├─ content-type gate (D-06): voice/text → continue; else → polite refusal, no cost
    │
    ▼
Bot handler (src/bot/handlers/voice.ts | text.ts)
    │ 1. idempotency PRE-CHECK: insert processed_updates row
    │    (update_id, status='processing') via onConflictDoNothing().returning()
    │    — empty return = already handled, STOP here, before any paid call
    ▼
    │ 2. ack: ctx.reply("Секунду, разбираю 🎧") → capture message_id
    ▼
    │ 3. fire application/voice-pipeline.ts WITHOUT awaiting inline in the
    │    update handler (grammY awaits handlers by default — the pipeline
    │    call itself must not block the update loop's return)
    ▼
application/voice-pipeline.ts (Telegram-agnostic orchestrator)
    │
    ├─ [voice only] Transcriber adapter: Buffer → text (STT)
    │       ↓ persist transcript immediately (survives a later crash)
    │
    ├─ DishDecomposer adapter: text → {items:[{component, component_en, grams}]}
    │       │  schema-invalid or throws → ONE retry with stricter prompt
    │       │  second failure → terminal "не смог разобрать" message, mark row failed
    │       │  well-formed empty items[] → "не услышал еды" message, NOT a retry (D-08)
    │       ↓
    ├─ per component (parallel, not sequential — Pitfall: sequential embedding calls):
    │       Embedder.embed(component_en) → vector (text-embedding-3-large@1536)
    │       ↓
    │       matchIngredient({embedding, repo}) → top-3 FdcCandidate[]
    │       ↓ weak-match flag if best similarity below threshold (D-21)
    │
    ├─ persist draft row (transcript + components + grams + candidates) — D-19
    │
    ├─ mark processed_updates row status='done'
    │
    └─ cost log line to terminal (STT seconds, LLM tokens, embed count, $) — D-17
    ▼
Bot handler: ctx.api.editMessageText(chatId, message_id, cardText) — D-13
    (read-only card: component / grams / matched FDC description / weak-match flag,
     NO КБЖУ numbers — D-20, D-18: no inline keyboard yet)
    ▼
User sees the decomposed, matched, read-only card. Phase 4 attaches buttons here.

Startup sweep (bot entrypoint, before bot.start()):
    SELECT * FROM processed_updates WHERE status='processing'
    → tell each affected user "анализ прервался, отправь ещё раз" (D-11, no auto-resume)
    → mark those rows 'interrupted' (terminal, not retried)
```

### Recommended Project Structure

```
src/
├── application/
│   └── voice-pipeline.ts        # orchestrator: STT → decompose → per-component embed+match → persist
├── adapters/
│   ├── stt/
│   │   ├── types.ts             # Transcriber port
│   │   └── openai-transcribe.ts # gpt-4o-mini-transcribe/gpt-4o-transcribe implementation
│   ├── llm/
│   │   ├── types.ts             # DishDecomposer port, DecompositionSchema (Zod)
│   │   └── openai-decompose.ts  # generateObject() implementation + retry-on-invalid
│   └── embeddings/               # REUSED, no changes — existing Embedder port
├── domain/
│   └── fdc-matching/              # REUSED, no changes — existing matchIngredient()
├── bot/
│   ├── handlers/
│   │   ├── voice.ts              # ctx.message.voice branch: duration cap, download, ack, fire pipeline
│   │   └── text.ts               # ctx.message.text branch: skip STT, same pipeline entry point
│   ├── formatting/
│   │   └── result-card.ts        # read-only card renderer (D-18/D-20/D-21)
│   └── telegram/
│       └── download-voice.ts     # ctx.getFile() → fetch → Buffer, no disk write
├── db/schema/
│   ├── processed-updates.ts      # NEW: update_id unique, status enum, timestamps
│   └── diary-drafts.ts           # NEW (name TBD): transcript, components jsonb/rows, status
└── scripts/
    └── verify-stt.ts             # NEW: D-04, gitignored sample-audio folder, both models side by side
```

### Structure Rationale

- `application/voice-pipeline.ts` stays the single orchestrator, matching ARCHITECTURE.md's Pattern 2/3 exactly — it must remain importable and unit-testable with zero grammY types, zero real network calls (fakes for `Transcriber`/`DishDecomposer`/`Embedder`/`FdcRepository`).
- `adapters/stt/` and `adapters/llm/` are new sibling directories to the existing `adapters/embeddings/` — same one-port-one-adapter shape already established, so the pattern is a copy of existing code, not an invention.
- `bot/handlers/` is new (Phase 2 only has `bot/commands/` and `bot/conversations/`) — voice/text message handlers are neither slash-commands nor multi-step conversations, so they get their own directory rather than being forced into either existing one.
- `db/schema/processed-updates.ts` and the draft table are separate files following the existing one-table-per-file convention (`users.ts`, `diary.ts`, `fdc-foods.ts`, `bot-sessions.ts`).

### Pattern 1: In-memory voice download (never touches disk, D-05)

**What:** `ctx.getFile()` returns Telegram's `file_path`; build the direct download URL, `fetch()` it, and read the response body into a `Buffer` — never `fs.writeFile`.
**When to use:** Every voice message, before any STT call.
**Example:**
```typescript
// src/bot/telegram/download-voice.ts
// Source: grammY context.d.ts (installed node_modules/grammy 1.45.1) +
// Telegram Bot API docs (file download URL shape)
import type { BotContext } from '../bot.js';

const MAX_VOICE_SECONDS = 60; // D-14

export class VoiceTooLongError extends Error {}

export async function downloadVoice(ctx: BotContext, token: string): Promise<Buffer> {
  const voice = ctx.message?.voice;
  if (!voice) throw new Error('downloadVoice called without a voice message');

  // D-14: check duration BEFORE download, before any paid call.
  if (voice.duration > MAX_VOICE_SECONDS) {
    throw new VoiceTooLongError(`${voice.duration}s exceeds ${MAX_VOICE_SECONDS}s cap`);
  }

  // ctx.getFile() is the context-aware alias for api.getFile — returns
  // { file_id, file_unique_id, file_size?, file_path? }. Bots can download
  // files up to 20MB (Telegram's own ceiling, distinct from the 50MB
  // *upload* limit — see PITFALLS.md #9).
  const file = await ctx.getFile();
  if (!file.file_path) {
    throw new Error('Telegram returned no file_path — file may be inaccessible (privacy setting?)');
  }

  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download voice file: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer); // never written to disk; handed directly to STT adapter
}
```

### Pattern 2: STT adapter using `toFile()` on an in-memory Buffer

**What:** OpenAI's Node SDK requires an `Uploadable` (`File`/`Blob`/stream-like) for `audio.transcriptions.create`. The SDK's own `toFile()` helper wraps a `Buffer` (which satisfies `ArrayBufferView`) into a `File`-like object without any filesystem interaction.
**When to use:** Every STT call.
**Example:**
```typescript
// src/adapters/stt/openai-transcribe.ts
// Source: node_modules/openai 7.4.0 — resources/audio/transcriptions.d.ts,
// internal/to-file.d.ts (verified directly against installed package)
import OpenAI, { toFile } from 'openai';
import { loadEnv } from '../../config/env.js';

/** D-03: single constant, not scattered through the code. */
export const STT_MODEL = 'gpt-4o-mini-transcribe';

export interface Transcriber {
  transcribe(audio: Buffer, opts?: { prompt?: string }): Promise<{
    text: string;
    /** OpenAI returns Tokens OR Duration usage depending on model/response_format. */
    usage?: unknown;
  }>;
}

export function createOpenAITranscriber(apiKey?: string): Transcriber {
  const client = new OpenAI({ apiKey: apiKey ?? loadEnv().OPENAI_API_KEY });

  return {
    async transcribe(audio, opts) {
      const file = await toFile(audio, 'voice.ogg', { type: 'audio/ogg' });
      const result = await client.audio.transcriptions.create({
        file,
        model: STT_MODEL,
        // D-07: seam for a glossary prompt, starts empty/undefined.
        prompt: opts?.prompt,
        // response_format defaults to 'json' for gpt-4o(-mini)-transcribe —
        // 'verbose_json' is NOT supported for these two models (only
        // whisper-1 supports verbose_json/srt/vtt), per the installed SDK's
        // AudioResponseFormat doc comment.
      });
      return { text: result.text, usage: result.usage };
    },
  };
}
```
**Note on format:** Telegram voice messages are OGG/OPUS. OpenAI's `gpt-4o-transcribe`/`gpt-4o-mini-transcribe`/`whisper-1` endpoints accept `ogg` directly per the installed SDK's `TranslationCreateParams.file` doc comment (`flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm`) — PITFALLS.md #9's caution about OGG not being "officially documented" for Whisper reflects older docs; the currently-installed SDK's type comments list `ogg` explicitly. Still worth a real-file smoke test in `verify-stt` rather than trusting the type comment alone (MEDIUM confidence — SDK type comments are not the same as a fetched pricing/docs page).

### Pattern 3: Decomposition via `generateObject()` + Zod, with the DECOMP-03 retry

**What:** One `generateObject()` call with a strict Zod schema; catch `NoObjectGeneratedError` for the "invalid or empty JSON" case; on that catch, retry once with a stricter/clarifying prompt; on second failure, produce the user-facing message. A **well-formed but empty** `items: []` is a *successful* `generateObject()` call — handle that as a separate branch (D-08), not inside the catch.
**Critical gotcha (verified via Context7 against `/vercel/ai` docs):** OpenAI's structured-output strict mode (default-on in `@ai-sdk/openai`) does **not** support `.optional()` or `.nullish()` fields — using them produces `NoObjectGeneratedError` with `finish_reason: 'content-filter'`, which looks like a content-safety rejection but is actually a schema-incompatibility bug. Use `.nullable()` instead, or omit optionality entirely and always populate the field.
**Example:**
```typescript
// src/adapters/llm/openai-decompose.ts
// Source: Context7 /vercel/ai (NoObjectGeneratedError pattern, OpenAI strict
// structured outputs constraint) + STACK.md §5
import { generateObject, NoObjectGeneratedError } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import { loadEnv } from '../../config/env.js';

/** D-16: single constant. gpt-4o-mini is a reasonable default: cheap,
 * supports strict structured outputs, same account as STT/embeddings.
 * [ASSUMED — not locked by CONTEXT.md; revisit if decomposition quality
 * on composite dishes proves insufficient in testing.] */
export const DECOMPOSITION_MODEL = 'gpt-4o-mini';

const ComponentSchema = z.object({
  component: z.string().min(1),
  component_en: z.string().min(1),
  // .nullable() not .optional() — OpenAI strict mode requirement (see above).
  // Field-level sanity bound per PITFALLS.md Pitfall 2: reject absurd grams
  // downstream, not in the schema itself (schema only enforces "is a number").
  grams: z.number().positive().max(2000),
});

export const DecompositionSchema = z.object({
  items: z.array(ComponentSchema), // empty array is VALID — D-08.
});

export type Decomposition = z.infer<typeof DecompositionSchema>;

export interface DishDecomposer {
  decompose(transcript: string): Promise<Decomposition>;
}

function buildPrompt(transcript: string, strict: boolean): string {
  const base = `Разложи описание блюда на компоненты-ингредиенты...`; // Claude's discretion — see Common Pitfalls below
  return strict
    ? `${base}\n\nПРЕДЫДУЩАЯ ПОПЫТКА НЕ ПРОШЛА ВАЛИДАЦИЮ. Верни ТОЛЬКО валидный JSON по схеме, без пояснений.`
    : base;
}

export function createOpenAIDecomposer(apiKey?: string): DishDecomposer {
  const openai = createOpenAI({ apiKey: apiKey ?? loadEnv().OPENAI_API_KEY });

  async function attempt(transcript: string, strict: boolean) {
    return generateObject({
      model: openai(DECOMPOSITION_MODEL),
      schema: DecompositionSchema,
      prompt: buildPrompt(transcript, strict),
      temperature: 0.1, // PITFALLS.md Pitfall 3: reduce (not eliminate) non-determinism
    });
  }

  return {
    async decompose(transcript) {
      try {
        const result = await attempt(transcript, false);
        return result.object; // may legitimately be { items: [] } — D-08, not a retry
      } catch (err) {
        if (NoObjectGeneratedError.isInstance(err)) {
          // DECOMP-03: exactly one retry, stricter prompt.
          try {
            const retryResult = await attempt(transcript, true);
            return retryResult.object;
          } catch (retryErr) {
            if (NoObjectGeneratedError.isInstance(retryErr)) {
              throw new Error('DECOMPOSITION_FAILED'); // handler maps to "не смог разобрать, опиши иначе"
            }
            throw retryErr;
          }
        }
        throw err; // network/5xx — ai SDK's own maxRetries (default 2) already
                    // retried transient failures before this catch is reached
      }
    },
  };
}
```
**Cost accounting (D-17):** `generateObject()`'s return value includes `result.usage` (`{ inputTokens, outputTokens, totalTokens }` in AI SDK v7's usage shape — confirm exact field names against the installed `ai@7.0.62` types at implementation time, since usage field naming has changed across AI SDK majors [MEDIUM confidence — not fetched from a pinned v7 usage-shape doc this session]). The OpenAI transcription response's `usage` field is a union (`Tokens | Duration`) per the installed SDK types — `gpt-4o-mini-transcribe` bills by tokens per the installed type comments, so expect the `Tokens` variant; log whichever shape comes back rather than assuming.

### Pattern 4: Idempotency gate via `onConflictDoNothing().returning()`

**What:** Insert a `processed_updates` row keyed on `update_id` (unique) with status `'processing'` *before* touching STT/LLM/embeddings. If the insert returns zero rows, another delivery of the same update already claimed it — stop immediately, no reply, no cost.
**Example:**
```typescript
// src/application/idempotency.ts
// Source: node_modules/drizzle-orm 0.45.2 — pg-core/query-builders/insert.d.ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { processedUpdates } from '../db/schema/processed-updates.js';

export async function claimUpdate(db: Db, updateId: number): Promise<boolean> {
  const rows = await db
    .insert(processedUpdates)
    .values({ updateId, status: 'processing' })
    .onConflictDoNothing({ target: processedUpdates.updateId })
    .returning({ updateId: processedUpdates.updateId });

  return rows.length > 0; // true = we claimed it, proceed; false = already handled, stop
}

export async function markUpdateDone(db: Db, updateId: number): Promise<void> {
  await db.update(processedUpdates).set({ status: 'done' }).where(eq(processedUpdates.updateId, updateId));
}
```
**Startup sweep (D-11):** at bot entrypoint, before `bot.start()`, `SELECT` all rows where `status = 'processing'`, notify each affected user, then flip them to a terminal `'interrupted'` status (not retried, not looped back into `'processing'`).

### Pattern 5: Ack-then-edit without blocking the update handler

**What:** grammY's default `bot.on(...)`/`bot.command(...)` handlers are `await`-ed by the framework's own dispatch loop — but the *pipeline call inside* the handler must not be awaited before the handler returns, or long-polling effectively serializes all users behind one slow pipeline run (violates D-12: "three voice messages in a row are all processed," which implies concurrent, not serialized, processing).
**Example:**
```typescript
// src/bot/handlers/voice.ts (sketch)
bot.on('message:voice', async (ctx) => {
  if (!(await claimUpdate(db, ctx.update.update_id))) return; // Pattern 4

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

  // Deliberately NOT awaited here — grammY has already logically "handled"
  // this update once we return; the pipeline runs after, off the polling
  // loop's critical path. Every error inside must be caught internally
  // (an unhandled rejection here is silent — no bot.catch coverage for a
  // detached promise).
  void processVoiceOrText({ db, buffer, chatId: ctx.chat.id, ackMessageId: ack.message_id })
    .catch((err) => console.error(`ошибка обработки update_id=${ctx.update.update_id}:`, describeError(err)));
});
```
**Confidence note:** grammY's own docs do not prescribe this "ack, then detach" idiom explicitly for long-polling (they discuss it mainly for webhook timeout avoidance) — this is a direct application of ARCHITECTURE.md's Pattern 1, generalized to polling, where the risk is not a webhook timeout but poll-loop starvation under D-12's concurrent-messages requirement. [MEDIUM confidence — reasoned extension, not a documented grammY recipe]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| JSON-shape enforcement from the LLM | Regex/manual JSON.parse + custom validators | `generateObject()` + Zod schema (OpenAI strict structured output) | Constrains token sampling itself — a syntactically-invalid response becomes structurally impossible, not just less likely; already the STACK.md decision (D-16) |
| Cosine-distance vector search / re-ranking | Fetching all `fdc_foods` rows and sorting in JS | `matchIngredient()` + `createDrizzleFdcRepository()` (existing, Phase 1) | Already built, ORDER BY-the-raw-expression invariant already fixed (Phase 1 gap-closure) — reimplementing here would silently regress the HNSW-index fix |
| Buffer → uploadable-file conversion for OpenAI | Manual multipart/form-data construction | `toFile()` from the `openai` package | Handles the `Uploadable` union correctly (Buffer satisfies `ArrayBufferView`), matches the SDK's own documented example pattern |
| Retry/backoff for transient OpenAI errors | A second, separate retry wrapper around `generateObject`/`transcriptions.create` | `ai` SDK's built-in `maxRetries` (default 2, handles `APICallError`/`GatewayError` with exponential backoff respecting `retry-after`) for the LLM call; the existing `embedBatchWithRetry` pattern in `openai-embed.ts` for embeddings (already built, reuse) | Two different retry concerns already exist in this codebase for two different SDKs — don't invent a third bespoke retry loop; the STT call can copy `openai-embed.ts`'s `isRetryable`/backoff shape verbatim since it's the same raw `openai` client |
| Idempotency dedup | An in-memory `Set<number>` of seen `update_id`s | `processed_updates` Postgres table + unique constraint | In-memory dies exactly in the crash-restart case it exists to protect against (D-10 explicitly rejects this) |

**Key insight:** every piece of infrastructure this phase needs already has a working precedent somewhere in the Phase 1/2 codebase (retry-with-backoff in `openai-embed.ts`, Postgres-backed persistence in `pg-storage-adapter.ts`, hexagonal ports in `fdc-matching`/`embeddings`) — the work here is applying the same shapes to three new adapters, not inventing new patterns.

## Common Pitfalls

### Pitfall 1: OpenAI strict structured output rejects `.optional()`/`.nullish()` Zod fields
**What goes wrong:** A schema field marked `.optional()` (e.g. an initial instinct to make `grams` optional "in case the LLM can't estimate it") produces `NoObjectGeneratedError` with `finish_reason: 'content-filter'` — a misleading error that looks like a content-safety block but is actually a schema-compatibility failure.
**Why it happens:** OpenAI's structured-output strict mode requires every property to be present in `required`; `.optional()`/`.nullish()` types don't map cleanly to that constraint the way `.nullable()` does.
**How to avoid:** Use `.nullable()` (never `.optional()`/`.nullish()`) for any field that might legitimately be absent, or restructure the schema so every field is always populated. [VERIFIED: Context7 `/vercel/ai` docs, "Generate Text with Incompatible Zod Schema" troubleshooting entry]
**Warning signs:** `NoObjectGeneratedError` with `cause` mentioning content-filter on every single call, even for obviously benign input.

### Pitfall 2: Sequential (not parallel) per-component embedding/matching calls
**What goes wrong:** A dish with 4-6 components (composite Central Asian dishes are exactly this case — бешбармак decomposes to lamb, dough, onion, broth) takes visibly longer if each component's embed+match round-trip is awaited one at a time.
**How to avoid:** `Promise.all()` across components for the embed+match step — the existing `Embedder.embed()` already batches multiple texts in ONE call when given an array, so prefer calling `embedder.embed(componentEnNames)` once with all component names rather than N separate single-text calls, THEN parallel `matchIngredient()` calls per resulting vector. [Restates PITFALLS.md's existing Performance Trap]
**Warning signs:** Response latency scaling linearly with component count.

### Pitfall 3: Over-decomposition or under-decomposition (DECOMP-02)
**What goes wrong:** A single-ingredient dish ("банан") gets artificially split (e.g., into "банан" + "кожура" as separate components), or a genuinely composite dish gets returned as one lump entry, defeating the product's core differentiator.
**Why it happens:** No explicit few-shot guidance in the prompt for the single-vs-composite boundary; the LLM defaults to "always find sub-parts" or "always summarize."
**How to avoid:** Prompt must include explicit few-shot examples covering both directions — one clearly single-ingredient case ("банан" → one item) and one clearly composite case (лазанья/бешбармак → multiple items) — and this behavior should be locked down with unit tests against a **fake** `DishDecomposer` returning canned LLM-shaped responses (testing the *pipeline's* handling of both shapes) plus a small number of real-call spot-checks during `/gsd-execute-phase` (testing the *prompt's* actual behavior, which cannot be unit-tested against a fake). [Claude's Discretion per CONTEXT.md — this is guidance, not a locked prompt]

### Pitfall 4: `grams` sanity bounds enforced only by Zod's type, not by plausibility
**What goes wrong:** Zod's `z.number().positive().max(2000)` catches "grams as a string" or "grams = -50" but not "banana estimated at 1900g" — technically within bounds, still absurd.
**How to avoid:** Per PITFALLS.md Pitfall 2, this is a UI/product mitigation (D-18's card shows grams prominently for the human to catch), not purely a schema-validation problem — the schema bound (1-2000g) is a hard backstop against garbage data reaching Postgres, not a claim of plausibility. Do not conflate "passes Zod" with "is a sane estimate."

### Pitfall 5: Confusing the AI SDK's built-in `maxRetries` with DECOMP-03's retry
**What goes wrong:** The `ai` SDK already retries transient network/5xx errors automatically (`maxRetries` defaults to 2, per `generateText`'s source — `generateObject` shares the same retry machinery). A naive reading of DECOMP-03 ("invalid/empty result triggers one retry") might try to implement a second, redundant retry wrapper around the whole call, double-retrying transient failures.
**How to avoid:** DECOMP-03's "one retry" is specifically for `NoObjectGeneratedError` (schema-validation failure) — a **manual, second `generateObject()` call with a stricter prompt**, distinct from the AI SDK's own transient-error retries which already happened *before* `NoObjectGeneratedError` would ever surface. Keep these two retry concerns conceptually and structurally separate (see Pattern 3's code example — the `catch` block only handles `NoObjectGeneratedError`, everything else rethrows).

### Pitfall 6: Detached pipeline promise swallowing errors silently
**What goes wrong:** `void processVoiceOrText(...).catch(...)` (Pattern 5) means `bot.catch()` (the existing `error-handler.ts`) never sees pipeline errors — they're caught by the local `.catch()` instead. If that local catch doesn't also tell the user something failed, the user is left staring at "Секунду, разбираю 🎧" forever with no resolution.
**How to avoid:** The pipeline's own internal error handling must edit the ack message into a failure notice (reusing D-13's "one message, edited in place" pattern for the failure path too, not just the success path) — never rely on `bot.catch()` to cover detached-promise failures, since `bot.catch()` only fires for errors thrown *during* the synchronous handler dispatch, not from promises that outlive it.

## Code Examples

See Architecture Patterns above (Patterns 1-5) for the primary verified code shapes: in-memory voice download, STT adapter with `toFile()`, decomposition adapter with `generateObject()`/Zod/retry, idempotency gate with `onConflictDoNothing().returning()`, and ack-then-detach handler wiring. All five are directly implementable against currently-installed package versions.

### Draft table schema sketch (D-19)
```typescript
// src/db/schema/diary-drafts.ts (name/shape is Claude's discretion — sketch only)
// Source: follows the fdc-foods.ts / diary.ts nullable-nutrient convention
// already established in this codebase.
import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const diaryDrafts = pgTable('diary_drafts', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  chatId: text('chat_id').notNull(),
  messageId: integer('message_id').notNull(), // the ack message D-13 edits in place
  transcript: text('transcript').notNull(),
  // components: [{component, componentEn, grams, candidates: FdcCandidate[3], chosenFdcId, weakMatch}]
  // jsonb, not normalized rows — Phase 4 owns further schema evolution per D-19.
  components: jsonb('components').notNull(),
  status: text('status').notNull().$type<'draft' | 'confirmed' | 'abandoned'>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
```

### `processed_updates` schema sketch (D-10/D-11)
```typescript
// src/db/schema/processed-updates.ts
import { bigint, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export const processedUpdates = pgTable(
  'processed_updates',
  {
    updateId: bigint('update_id', { mode: 'number' }).primaryKey(), // Telegram update_id — natural key, no surrogate id needed
    status: text('status').notNull().$type<'processing' | 'done' | 'interrupted' | 'failed'>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
);
```
Both tables need generated migrations (`npm run db:generate`) + RLS migrations following the `0004_bot_sessions_rls.sql` template (enable RLS, revoke `anon`/`authenticated` if present) — `processed_updates` and drafts both hold or reference sensitive data (health/food descriptions, user linkage) per the same rationale already documented for `bot_sessions`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Prompt-only "please return JSON" | Provider-native structured output (`strict: true` json_schema) via `generateObject`/Zod | Already current practice by 2025-2026 per STACK.md; not a mid-phase change | Already the locked decision (D-16) — no action needed, just confirming this is not stale guidance |
| `whisper-1` as default transcription model | `gpt-4o-transcribe`/`gpt-4o-mini-transcribe` family (token-usage-based billing option in addition to per-minute) | OpenAI's newer transcribe models supersede `whisper-1` for most 2026 use cases per aggregator pricing pages, though `whisper-1` remains available | D-03 already locks `gpt-4o-mini-transcribe`; note that `whisper-1` is the *fallback if the mini model proves too weak on Kazakh vocabulary* per STACK.md, not the primary path |

**Deprecated/outdated:** None specific to this phase's stack surfaced during research — all recommended libraries are current majors per live npm registry checks.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `gpt-4o-mini` is a reasonable default decomposition model (cost/quality/strict-structured-output support) | Pattern 3, Code Examples | Not locked by CONTEXT.md (D-16 only locks "a constant, held in config"); if decomposition quality on composite Central Asian dishes proves weak, swap the constant — no architectural rework needed since D-16 already isolates it |
| A2 | OGG/OPUS is directly accepted by `gpt-4o-mini-transcribe`/`gpt-4o-transcribe` (per installed SDK type-comment listing `ogg` as a supported format) | Pattern 2 | If wrong, an FFmpeg conversion step is needed before the STT call — budget this as a fallback task, verify with a real audio file in `verify-stt` before assuming it's unnecessary |
| A3 | `result.usage` on `generateObject()`'s return value has stable, documented field names in AI SDK v7 (`inputTokens`/`outputTokens`/`totalTokens` or similar) suitable for D-17's cost log | Pattern 3 (Cost accounting note) | If the exact field names differ, the cost-log line needs adjusting — low risk (a type-check will catch it immediately at implementation time), not a design-level risk |
| A4 | Ack-then-detach (Pattern 5) does not require any additional grammY concurrency configuration under long polling | Pattern 5 | If grammY's default polling loop turns out to serialize awaited handlers in a way that still blocks on the detached promise somehow, D-12 ("three voice messages in a row are all processed") could degrade to sequential rather than concurrent — worth a manual multi-message-burst test during execution, not just a unit test |
| A5 | A `bigint`/number-mode Telegram `update_id` fits safely as a Postgres `bigint` primary key with no overflow risk in this project's lifetime | Code Examples (`processed_updates` schema) | Extremely low risk — Telegram update_ids are well within `bigint` range; flagged only for completeness |

**If this table is empty:** N/A — see entries above; all are low-to-medium risk and mostly self-correcting at typecheck/implementation time, none block planning.

## Open Questions

1. **Exact `usage`/cost-field shapes for `ai@7.0.62`'s `generateObject()` and `openai@7.4.0`'s transcription `usage` union**
   - What we know: Both SDKs return *some* usage object; `Transcription.Tokens | Transcription.Duration` is a documented union in the installed OpenAI SDK types; AI SDK v7 documents `result.usage` but this research did not pin the exact field names for v7 (only saw a v-agnostic `console.log('Token usage:', result.usage)` example).
   - What's unclear: The precise property names to read for D-17's per-message cost line.
   - Recommendation: Resolve at implementation time via `tsc`/IDE autocomplete against the installed types — this is a fast, low-risk lookup, not worth blocking planning on.

2. **Exact wording and threshold for D-21's "weak match" flag**
   - What we know: A weak candidate must be shown, flagged, never dropped; threshold is unspecified in CONTEXT.md.
   - What's unclear: What similarity score counts as "weak" (e.g., top candidate's `similarity < 0.7`?). No prior phase established this number — Phase 1's `verify-matches.ts` computes similarity but doesn't threshold it into weak/strong.
   - Recommendation: Claude's discretion at plan time; pick a documented, named constant (e.g., `WEAK_MATCH_SIMILARITY_THRESHOLD = 0.7`) and validate it against a handful of real transcripts during `/gsd-execute-phase`, not a hardcoded magic number buried in formatting code.

3. **Exact decomposition prompt text for composite Central Asian dishes**
   - What we know: This is explicitly Claude's discretion (CONTEXT.md), and explicitly "the single biggest accuracy lever in the phase."
   - What's unclear: No prompt draft exists yet.
   - Recommendation: Per CONTEXT.md's own guidance, express expectations as unit tests against a fake `DishDecomposer` (verifying the *pipeline* handles both single-item and multi-item shapes correctly) plus a documented set of real-call spot-check phrases (бешбармак, куырдак, плов, манты, банан, "200 г риса") to run manually/via a small script during execution — not something this research should pre-write, since the actual prompt needs iteration against real model output.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | engines: `>=22` (package.json) | — |
| `openai` npm package | STT, runtime embeddings | ✓ (installed) | 7.4.0 | — |
| `ai` npm package | LLM decomposition | ✗ (not yet installed) | target 7.0.62 | `npm install ai@7.0.62` — no fallback needed, standard install |
| `@ai-sdk/openai` npm package | Model resolution for `generateObject` | ✗ (not yet installed) | target 4.0.40 | `npm install @ai-sdk/openai@4.0.40` |
| `zod` npm package | Decomposition schema | ✗ (not yet installed) | target 4.4.3 | `npm install zod@4.4.3` |
| `OPENAI_API_KEY` | STT + LLM + embeddings (all three now share this key) | ✓ (already required per `src/config/env.ts REQUIRED_ENV_KEYS`, set up in Phase 1) | — | — |
| Postgres reachability (Supabase) | `processed_updates`, draft table, all reads/writes | ✓ (already required, `DATABASE_URL`) | — | — |
| `TELEGRAM_BOT_TOKEN` | Voice download URL construction, bot itself | ✓ (already required, Phase 2) | — | — |
| A folder of ~10 real sample voice recordings for `verify-stt` | D-04 success criterion 2 | ✗ (owner must supply; gitignored, not part of repo) | — | Document in the plan: "create `samples/` (gitignored), drop ~10 `.ogg`/`.m4a` voice files there" |

**Missing dependencies with no fallback:** None — the three npm packages are a standard `npm install` away, and the sample-audio folder is an owner action already anticipated by D-04 with a documented setup step, not a blocker to planning.

**Missing dependencies with fallback:** `ai`, `@ai-sdk/openai`, `zod` — straightforward installs, no workaround needed, just not yet present in `package.json`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (installed, house standard since Phase 1) |
| Config file | none — Vitest's zero-config defaults, matching existing `*.test.ts` co-located files |
| Quick run command | `npx vitest run <path-to-file>.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|---------------|
| VOICE-01 | Voice message accepted, non-voice/non-text rejected politely (D-06) | unit | `npx vitest run src/bot/handlers/voice.test.ts` | ❌ Wave 0 |
| VOICE-02 | Ack sent before pipeline work begins; pipeline never awaited inline | unit (fake ctx, assert reply-then-detach ordering) | `npx vitest run src/bot/handlers/voice.test.ts` | ❌ Wave 0 |
| VOICE-03 | STT adapter builds correct `toFile`/model/prompt args; real transcription verified manually | unit (fake `OpenAILike`-style client) + `verify-stt` script (real API, human spot-check) | `npx vitest run src/adapters/stt/openai-transcribe.test.ts` + `npm run verify-stt` | ❌ Wave 0 |
| VOICE-04 | Text message flows through identical pipeline seam as transcribed voice | unit (assert same `application/voice-pipeline.ts` entry point is called with equivalent shape) | `npx vitest run src/application/voice-pipeline.test.ts` | ❌ Wave 0 |
| DECOMP-01 | Decomposition schema validates a well-formed multi-item response | unit (fake `DishDecomposer`) | `npx vitest run src/adapters/llm/openai-decompose.test.ts` | ❌ Wave 0 |
| DECOMP-02 | Single-ingredient input yields exactly one component (pipeline-level contract, prompt behavior spot-checked separately) | unit (fake decomposer returning single-item canned response; assert pipeline doesn't split it) + manual real-call spot-check | `npx vitest run src/application/voice-pipeline.test.ts` | ❌ Wave 0 |
| DECOMP-03 | Invalid/empty-malformed response retries once, then fails gracefully; well-formed-empty does NOT retry (D-08) | unit (fake decomposer throwing `NoObjectGeneratedError` once then succeeding; throwing twice; returning `{items:[]}` cleanly) | `npx vitest run src/adapters/llm/openai-decompose.test.ts` | ❌ Wave 0 |
| Idempotency (D-10/D-11, cross-cutting) | Duplicate `update_id` is a no-op after first claim; startup sweep notifies stuck `processing` rows | unit (fake/test-db insert-conflict assertion) | `npx vitest run src/application/idempotency.test.ts` | ❌ Wave 0 |
| Weak-match flag (D-21) | Below-threshold similarity is flagged, never dropped | unit (fake candidates around the threshold boundary) | `npx vitest run src/bot/formatting/result-card.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** run the specific new/changed test file(s) via the quick command above.
- **Per wave merge:** `npm test` (full suite) — this phase adds enough cross-cutting state (idempotency, draft persistence) that a full-suite pass at each wave boundary is warranted, matching Phase 1/2's own practice.
- **Phase gate:** Full suite green, plus `npm run verify-stt` run by the owner against real sample audio (D-04, success criterion 2 — this one is fundamentally a human-judgment check, not automatable), before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `src/adapters/stt/openai-transcribe.test.ts` — covers VOICE-03 (fake `OpenAILike` client, mirroring `openai-embed.test.ts`'s existing fake-client pattern)
- [ ] `src/adapters/llm/openai-decompose.test.ts` — covers DECOMP-01/02/03
- [ ] `src/application/voice-pipeline.test.ts` — covers VOICE-04, cross-cutting orchestration, DECOMP-02's pipeline-level contract
- [ ] `src/application/idempotency.test.ts` — covers the `processed_updates` claim/release logic
- [ ] `src/bot/handlers/voice.test.ts` — covers VOICE-01/02, D-06 content-type gate, D-14 duration cap
- [ ] `src/bot/formatting/result-card.test.ts` — covers D-18/D-20/D-21 card rendering
- [ ] `scripts/verify-stt.ts` — NEW verify-* script, D-04 (not a Vitest file — a runnable script following the `verify-matches.ts` house style)
- [ ] Framework install: `npm install ai@7.0.62 @ai-sdk/openai@4.0.40 zod@4.4.3` — required before any of the above compiles

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|---------------------|
| V2 Authentication | No (new work) | Already covered by Phase 2's allowlist gate — Phase 3 adds no new auth surface |
| V3 Session Management | No (new work) | Reuses Phase 2's `bot_sessions`-backed grammY session storage unchanged |
| V4 Access Control | Partial | Every new handler (voice/text) MUST register after the existing allowlist middleware (already enforced by `bot.ts`'s registration order + `bot.wiring.test.ts` per CONTEXT.md's code_context) — no new access-control code needed, just correct placement |
| V5 Input Validation | Yes | Zod schema validation on all LLM output (DECOMP-03); `grams` bounds (1-2000); voice `duration` bound (≤60s, D-14); content-type allowlist (D-06) |
| V6 Cryptography | No | No new secrets/crypto surface — reuses existing `OPENAI_API_KEY`/`TELEGRAM_BOT_TOKEN` env handling via `src/config/env.ts`, no new key material |
| V7 Error Handling & Logging | Yes | `error-handler.ts`'s existing invariant (never log the full `ctx`/update object, since message text is health data) MUST extend to the new pipeline: never log transcript text or raw audio content in error paths; log only counts/status/error kind, matching `openai-embed.ts`'s existing "never log the embedded text" precedent |
| V9 Communications | No (new work) | HTTPS to `api.telegram.org` and `api.openai.com` via standard SDK/fetch TLS defaults — no custom transport code |
| V13 API and Web Service | Partial | The OpenAI API calls (STT, decomposition, embeddings) are outbound only — no new inbound API surface this phase (still long-polling, no webhook) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-------------------------|
| Duplicate/replayed Telegram update triggers duplicate paid API calls | Tampering / Repudiation (resource exhaustion via retry) | `processed_updates` idempotency gate (D-10), insert-before-any-paid-call ordering — already the phase's core architecture, not an add-on |
| Sensitive data (voice transcript = health/diet data) retained longer than necessary or logged in cleartext | Information Disclosure | D-05: audio never touches disk/logs; transcript IS persisted (needed downstream) but only in Postgres (RLS-protected per the `bot_sessions`/`fdc_foods` precedent), never in `console.log`/error paths — extend `error-handler.ts`'s existing "never log ctx" rule explicitly to the new pipeline's own logging |
| Runaway spend from a bug (retry loop, duplicate processing) or a single abusive/confused user | Denial of Service (financial) | D-14 (60s duration cap, checked pre-download/pre-paid-call), D-15 (soft 30/day per-user cap), D-17 (visible per-message cost line makes anomalies noticeable same-day) — all three already locked decisions, not proposals |
| Malformed/adversarial LLM output reaching downstream calculation or storage | Tampering (data integrity) | Zod schema validation (DECOMP-03) + field-level bounds (`grams` 1-2000) before anything touches Postgres or is shown to the user |
| Telegram file URL exposes the bot token in the query/path | Information Disclosure (if logged) | The download URL (`https://api.telegram.org/file/bot<TOKEN>/...`) embeds the bot token directly in the URL path — this file MUST NOT be logged anywhere (console, error messages, telemetry) in `download-voice.ts` or its callers; this is a new, phase-specific instance of the existing "never log the token" rule from `error-handler.ts`'s module doc comment |

## Sources

### Primary (HIGH confidence)
- Installed `node_modules/openai` 7.4.0 — `resources/audio/transcriptions.d.ts`, `resources/audio/audio.d.ts`, `resources/audio/translations.d.ts` (supported formats), `internal/to-file.d.ts`, `internal/uploads.d.ts` — read directly this session
- Installed `node_modules/grammy` 1.45.1 — `out/context.d.ts` (`getFile`), `node_modules/@grammyjs/types/message.d.ts` (`Voice`, `File` interfaces) — read directly this session
- Installed `node_modules/drizzle-orm` 0.45.2 — `pg-core/query-builders/insert.d.ts` (`onConflictDoNothing`) — read directly this session
- `npm view ai version` / `versions` / `dist-tags`, `npm view @ai-sdk/openai version`, `npm view zod version`, `npm view openai version` — live registry queries, 2026-08-12
- Context7 `/vercel/ai` — `generateObject`/Zod usage pattern, `NoObjectGeneratedError` handling, OpenAI strict-structured-output `.nullable()` vs `.optional()`/`.nullish()` constraint, `generateText`/`generateObject` shared `maxRetries` (default 2) retry machinery
- This repo: `src/domain/fdc-matching/*`, `src/adapters/fdc-repository.ts`, `src/adapters/embeddings/*`, `src/bot/bot.ts`, `src/bot/error-handler.ts`, `src/config/env.ts`, `src/db/client.ts`, `src/db/schema/*`, `scripts/index-fdc/verify-matches.ts`, `package.json` — read directly this session
- `TECH_SPEC.md` §3.3, §5.1-5.8, §10 — this repo, read directly this session
- `.planning/phases/03-voice-pipeline/03-CONTEXT.md` — this phase's locked decisions (D-01..D-21), authoritative

### Secondary (MEDIUM confidence)
- WebSearch, OpenAI transcription pricing ($0.006/min `gpt-4o-transcribe`, $0.003/min `gpt-4o-mini-transcribe`; token-based $2.50/$10 per 1M and $1.25/$5 per 1M respectively) — cross-referenced across gate.ai, openrouter.ai, tokenmix.ai, costgoat.com; not fetched directly from platform.openai.com/pricing this session (same caveat STACK.md already carries)
- WebSearch, `gpt-4o-mini` pricing ($0.15/$0.60 per 1M input/output tokens) — cross-referenced across openrouter.ai, pricepertoken.com, finout.io

### Tertiary (LOW confidence)
- None used as a standalone claim in this document — all WebSearch findings above were cross-referenced across 3+ sources per the source-hierarchy protocol

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified live against npm registry this session; `openai`/`grammy`/`drizzle-orm` call shapes verified directly against installed `node_modules` type declarations, not recalled from training data
- Architecture: HIGH — directly extends already-shipped Phase 1/2 patterns (hexagonal ports, Postgres-backed persistence, ack-first) with no new architectural primitives; the ack-then-detach-under-polling idiom (Pattern 5) is MEDIUM (reasoned extension, not a documented grammY recipe)
- Pitfalls: HIGH for the OpenAI-strict-structured-output `.nullable()` gotcha (Context7-verified against official AI SDK docs) and idempotency/detached-promise pitfalls (direct extension of this repo's existing patterns); MEDIUM for OGG/OPUS format acceptance (SDK type-comment-sourced, not a fetched, dated docs page) — flagged explicitly for a real-audio smoke test in `verify-stt`

**Research date:** 2026-08-12
**Valid until:** ~2026-09-12 (30 days) for library/version claims — this is a fast-moving stack (`ai`/`@ai-sdk/openai` ship frequent patch releases); re-verify versions at `/gsd-plan-phase` or execution time if this research is consumed materially later than that window. STT/LLM pricing figures should be re-checked against platform.openai.com/pricing directly before finalizing D-17's cost-log math, since this session's pricing sources were aggregator sites, not the primary pricing page.
