# Architecture Research

**Domain:** Webhook-driven Telegram bot + multi-step AI pipeline (STT → LLM → embedding/vector search) + deterministic domain math, backed by an offline-indexed reference dataset (USDA FDC)
**Researched:** 2026-08-10
**Confidence:** HIGH (component boundaries, webhook-ack pattern, hexagonal separation — standard, well-documented patterns) / MEDIUM (exact Telegram webhook retry timing — not published in official docs, inferred from community reports)

This document validates and refines the architecture already proposed in `TECH_SPEC.md` §4-5 rather than inventing a new one. The overall shape in TECH_SPEC (webhook → job queue → voice worker → external APIs → Postgres/pgvector, with a separate offline FDC indexing script and a separate notification scheduler) is the standard shape for this class of system. The refinements below are about making that shape concrete enough to plan phases against: what must be async vs what can stay simple for v1, how the domain layer stays Telegram-agnostic, and how the one-time indexing pipeline relates to the runtime service.

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Telegram (external)                          │
│         sends updates via webhook · receives replies via Bot API     │
└───────────────────────────────┬────────────────────────────────────-┘
                                 │ HTTPS webhook (must ack fast)
┌────────────────────────────────▼───────────────────────────────────┐
│                     Bot Layer (Telegram adapter)                    │
│  ┌────────────────┐  ┌────────────────────┐  ┌───────────────────┐ │
│  │ Webhook handler │  │ Command/onboarding │  │ Inline keyboard /  │ │
│  │ (grammY/Telegraf│  │ flow (grammY       │  │ callback_query     │ │
│  │  entrypoint)    │  │  session/scenes)   │  │ handlers (correct) │ │
│  └────────┬────────┘  └──────────┬─────────┘  └─────────┬─────────┘ │
└───────────┼──────────────────────┼──────────────────────┼───────────┘
            │ calls (via ports/interfaces, no Telegram types leak below)
┌───────────▼──────────────────────▼──────────────────────▼───────────┐
│                          Application / Orchestration                │
│  ┌────────────────────────────┐   ┌────────────────────────────┐   │
│  │ Voice pipeline orchestrator │   │ Onboarding / TDEE service   │   │
│  │ (enqueue + step sequencing) │   │ (pure calculation, no I/O)  │   │
│  └──────────────┬───────────────┘   └────────────────────────────┘   │
└─────────────────┼─────────────────────────────────────────────────--┘
                   │ (in-process async for v1; swappable for BullMQ later)
┌──────────────────▼──────────────────────────────────────────────────┐
│                     Voice Processing Worker/Job                     │
│  STT client → LLM decomposition client → per-ingredient:            │
│  translate(in-LLM) → embedding client → FDC vector search            │
└───────┬──────────────┬──────────────┬──────────────┬────────────────┘
        │              │              │              │
   ┌────▼───┐    ┌─────▼────┐   ┌─────▼─────┐  ┌─────▼──────────────┐
   │STT API │    │ LLM API  │   │Embedding  │  │ Postgres + pgvector │
   │(Whisper│    │(Claude/  │   │API        │  │ - fdc_foods (vector)│
   │/Yandex)│    │GPT struct│   │(gemini/   │  │ - users, diary,     │
   │        │    │output)   │   │ 3-small)  │  │   subscriptions     │
   └────────┘    └──────────┘   └───────────┘  └─────────────────────┘
                                                          ▲
┌─────────────────────────────────────────────────────────┴───────────┐
│         Offline FDC Indexing Pipeline (separate entrypoint,          │
│         same repo, run manually/rarely — NOT part of request path)   │
│  download FDC dump → parse → build embedding per food →              │
│  write into fdc_foods(embedding, nutrients_per_100g, version)        │
└────────────────────────────────────────────────────────────────────┘

Deferred phases (not built now, but the schema below anticipates them):
┌─────────────────────┐        ┌──────────────────────────────────┐
│ Payment webhook      │        │ Notification scheduler (cron)     │
│ receiver (separate   │        │ reads users+diary, writes         │
│ public HTTP endpoint,│        │ nothing back into voice pipeline  │
│ signature-verified)  │        │                                    │
└─────────────────────┘        └──────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| Webhook handler | Receive Telegram update, ack fast, dispatch to command/callback router | grammY/Telegraf `webhookCallback` mounted on a lightweight HTTP framework (Fastify/Express) |
| Bot layer (commands, onboarding, keyboards) | Telegram-specific UX: message formatting, inline keyboard construction, session/scene state, translating callback_query payloads into domain calls | grammY sessions or hand-rolled state machine keyed by chat_id, stored in Postgres (not in-memory) |
| Voice pipeline orchestrator | Sequences STT → LLM decomposition → per-ingredient FDC matching; owns retry/error policy per step; is the seam where "queue" plugs in later | Plain async function/class in `application/` or `pipeline/`, invoked by the bot layer, not aware of Telegram types |
| Domain: nutrition calculation | Deterministic KБЖУ math (grams × nutrient/100g, TDEE/BMR/target formulas) | Pure functions, zero I/O, zero external deps — the most unit-testable part of the system |
| Domain: FDC matching | Given an ingredient (translated name + embedding), query pgvector for top-N candidates, return structured candidates | Function taking an embedding vector + repository interface, returns typed candidate list; embedding generation itself is an adapter call, not domain logic |
| STT/LLM/Embedding adapters | Wrap each external API behind a small interface (`transcribe()`, `decompose()`, `embed()`) | One adapter module per provider; interface defined once so provider can be swapped (TECH_SPEC §11 explicitly leaves STT/embedding provider open) |
| Postgres + pgvector | System of record: users, onboarding profile, diary entries, subscriptions (later), and `fdc_foods` reference table with vector column | Single Postgres instance; pgvector extension; no separate vector DB needed at this data volume (~10-13k rows) |
| Offline FDC indexing pipeline | One-time/rare batch job: download USDA FDC dump, embed each food, populate `fdc_foods` | Standalone CLI script in the same repo, sharing DB schema and embedding adapter code with the runtime bot, but never invoked by a request |
| (Deferred) Payment webhook receiver | Separate public HTTP endpoint, verifies acquirer signature, flips subscription status only on confirmed webhook | Isolated route, does not touch voice pipeline; additive |
| (Deferred) Notification scheduler | Cron/interval worker reading `users`/`diary`/`subscriptions`, sends proactive messages via Bot API | Separate process or scheduled job; read-heavy, no coupling to voice pipeline internals beyond shared tables |

## Recommended Project Structure

```
src/
├── bot/                      # Telegram-specific adapter layer — the ONLY place grammY/Telegraf types appear
│   ├── webhook.ts            # HTTP entrypoint, mounts webhookCallback, must return fast
│   ├── commands/              # /start, onboarding step handlers
│   ├── keyboards/             # inline keyboard builders (candidate picker, grams +/-10, confirm)
│   ├── callbacks/             # callback_query router → maps to application/domain calls
│   └── formatting/            # message templates (Russian copy), kept out of domain logic
│
├── application/               # Orchestration — sequences steps, has no Telegram or DB-driver imports
│   ├── voice-pipeline.ts      # STT → decompose → per-ingredient match, step-by-step with typed errors
│   └── onboarding-flow.ts     # collects profile fields, calls domain/nutrition for target KБЖУ
│
├── domain/                    # Pure business logic — framework-agnostic, fully unit-testable
│   ├── nutrition/
│   │   ├── bmr-tdee.ts        # Mifflin-St Jeor + activity coefficient
│   │   ├── target-calories.ts # rate cap (1 kg/month), safety floor
│   │   └── aggregate.ts       # grams × nutrients/100g → totals (no LLM involvement, ever)
│   └── fdc-matching/
│       ├── match-ingredient.ts # takes embedding + repository port, returns top-N candidates
│       └── types.ts
│
├── adapters/                  # External API clients, each behind a narrow interface (port)
│   ├── stt/                   # e.g. whisper.ts implementing Transcriber
│   ├── llm/                   # decomposition.ts implementing DishDecomposer (structured output)
│   ├── embeddings/            # embed.ts implementing Embedder (shared by runtime + indexer)
│   └── fdc-repository.ts      # Postgres/pgvector queries implementing FdcRepository port
│
├── db/
│   ├── schema/                # migrations: users, diary, fdc_foods(vector), subscriptions (stub)
│   └── client.ts
│
├── scripts/
│   └── index-fdc/             # ONE-TIME batch pipeline, separate CLI entrypoint, not deployed as a service
│       ├── download.ts        # fetch USDA FDC Foundation + SR Legacy dump
│       ├── build-embeddings.ts
│       └── load.ts            # idempotent upsert into fdc_foods, records dataset+model version
│
└── config/                    # env/secrets loading, provider selection (STT/LLM/embedding provider swap point)
```

### Structure Rationale

- **`bot/` vs `application/`/`domain/`:** this is the load-bearing boundary for testability. `domain/` and most of `application/` should be unit-testable with zero network calls and zero Telegram mocks — feed in a transcript string or a list of `{name, grams}` and assert on the numeric output. `bot/` is the only layer that imports grammY/Telegraf and knows about chat_id, message formatting, inline keyboards.
- **`adapters/`:** every external API (STT, LLM, embeddings) sits behind a one-method-ish interface defined near its usage (or in `application/ports.ts`). This directly serves TECH_SPEC §11's open questions (Whisper vs Yandex, gemini-embedding vs OpenAI) — swapping providers means writing a new adapter file and changing a config value, not touching `domain/` or `application/`.
- **`scripts/index-fdc/`:** lives in the same repo as the bot (shares `adapters/embeddings`, `db/schema`, and the `fdc_foods` type) but is a separate entrypoint (`npm run index-fdc`), not part of the deployed bot process, and not triggered by any request. This avoids duplicating the embedding-provider code while keeping the batch job's lifecycle (run once, rerun rarely on dataset refresh) fully decoupled from the bot's lifecycle (always running, request-driven).
- **`config/`:** centralizes which STT/LLM/embedding provider is active — this is the single place TECH_SPEC's still-open provider decisions get wired in, so trying a different provider is a config change plus one new adapter file.

## Architectural Patterns

### Pattern 1: Ack-first webhook handling (do not process inline in the HTTP response path)

**What:** The webhook HTTP handler's only synchronous job is: validate the update, persist/enqueue a job (or at minimum kick off async work without awaiting it before responding), and return 200 immediately. All STT/LLM/embedding calls happen after the response has already been sent.
**When to use:** Always, for this system — not optional. TECH_SPEC itself identifies this correctly in §4 ("несколько секунд и несколько внешних API-вызовов подряд").
**Why it's non-negotiable, not just a nice-to-have:** Telegram does not publish an exact webhook timeout in its official docs, but community reports (grammY docs, tdlib/telegram-bot-api issue threads) consistently describe Telegram re-delivering the same update if the webhook is slow or errors, which without idempotency causes duplicate processing (double LLM calls, double diary entries) — not just a slow UX. This is a correctness requirement, not a latency-tuning nicety. **Confidence: MEDIUM** (exact timeout number unconfirmed in official docs; the retry behavior itself is corroborated by multiple independent community sources).
**Trade-offs:** Requires an idempotency key (Telegram `update_id` or `message_id`) to make retried webhook deliveries safe — check-and-skip if already processing/processed before starting the pipeline again.

**Example:**
```typescript
// bot/webhook.ts
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;
  res.sendStatus(200); // ack immediately — do NOT await the pipeline first
  if (await alreadyProcessing(update.update_id)) return; // idempotency guard
  void voicePipeline.handle(update).catch(err => logger.error(err)); // fire-and-forget, errors handled inside
});
```

### Pattern 2: Queue is a seam, not a v1 requirement — but code must be written as if it existed

**What:** TECH_SPEC's own recommendation (§4) is correct: for a closed beta of a handful of users, a real durable queue (BullMQ + Redis) is over-engineering. What matters is that the **orchestrator** (`application/voice-pipeline.ts`) exposes an `enqueue(job)` / `process(job)` seam so a durable queue can be dropped in later without touching STT/LLM/matching logic.
**When to use:** v1 = in-process async (e.g., `setImmediate`/plain `async` fire-and-forget from the webhook handler, each pipeline step wrapped with its own try/catch and a small retry-with-backoff for transient API failures). Add BullMQ+Redis when: (a) beta grows past "a few friends," (b) you need work to survive a process restart, or (c) you need to rate-limit concurrent external API calls.
**Trade-offs:** In-process async loses jobs on process crash/restart mid-pipeline — acceptable for closed beta (worst case: user resends the voice message), not acceptable once paying subscribers exist. This is a concrete signal for when a later phase should introduce a real queue, but it does not block v1.

### Pattern 3: Domain logic behind ports, Telegram and external APIs as adapters (hexagonal-style)

**What:** `domain/nutrition` and `domain/fdc-matching` depend on nothing but their own types and small interfaces (`FdcRepository`, `Embedder`) passed in by the caller. `bot/` and `adapters/` depend on `domain/`; `domain/` never depends on `bot/` or `adapters/`.
**When to use:** Always for this project — it's the direct answer to "how do I unit-test nutrition math and FDC matching without hitting Telegram or real APIs." Feed `match-ingredient.ts` a fake `FdcRepository` returning canned candidates and assert ranking/threshold behavior; feed `aggregate.ts` a list of `{grams, nutrientsPer100g}` and assert totals — no mocks of Telegram, no network.
**Trade-offs:** Slightly more ceremony (defining interfaces) than importing a DB client directly into business logic, but it's what makes the riskiest part of this product (accuracy of decomposition/matching/math per PROJECT.md's Core Value) actually testable in CI without live API keys.

**Example:**
```typescript
// domain/fdc-matching/match-ingredient.ts — no imports from bot/ or adapters/
export interface FdcRepository {
  searchByEmbedding(vector: number[], topN: number): Promise<FdcCandidate[]>;
}
export async function matchIngredient(
  embedding: number[],
  repo: FdcRepository,
  topN = 3
): Promise<FdcCandidate[]> {
  return repo.searchByEmbedding(embedding, topN);
}
```

### Pattern 4: Correction state lives in Postgres, not in bot memory

**What:** When the bot shows the "разбор блюда" card with inline candidate-picker/±10g/remove/add buttons, the draft record (LLM decomposition + chosen FDC candidate per component + current grams) is persisted as a `diary_draft` row keyed by `(user_id, message_id)` or similar, not held in an in-process Map/session object.
**When to use:** Always — even for a single-process v1. Telegram callback_query for "pick candidate 2 of 3" can arrive minutes after the original card was sent (or after a process restart/deploy), so state must survive process boundaries.
**Trade-offs:** One extra table + a couple of extra queries per correction step, in exchange for correctness across restarts and (later) horizontal scaling.

## Data Flow

### Voice message flow (primary flow, v1 scope)

```
User sends voice message
    ↓
Telegram → webhook POST → bot/webhook.ts
    ↓ (ack 200 immediately, idempotency check on update_id)
bot layer sends "Секунду, разбираю 🎧" via Bot API (separate outgoing call, not the webhook response)
    ↓
application/voice-pipeline.ts (async, off the request path)
    ↓
STT adapter: audio file → transcript text
    ↓
LLM adapter: transcript → structured {items:[{component, component_en, grams}]} (schema-validated; retry on invalid JSON)
    ↓ per item
Embedding adapter: component_en → vector
    ↓
domain/fdc-matching: vector → pgvector query against fdc_foods → top-3 candidates
    ↓
Persist diary_draft (all components + chosen-by-default candidate + grams) to Postgres
    ↓
bot layer renders confirm/correct card via Bot API (inline keyboards from keyboards/)
    ↓
User taps ✅ or ✏️
    ↓ (✏️ path loops back through callbacks/ → application/ → domain/fdc-matching for re-picks; ✅ path:)
domain/nutrition/aggregate.ts: sum(grams/100 × nutrients_per_100g) per component → dish totals (pure math, no LLM)
    ↓
Write confirmed entry to diary table; update day totals
    ↓
Bot API: send confirmation message
```

### FDC indexing flow (offline, decoupled from the above)

```
scripts/index-fdc/download.ts → USDA FDC Foundation + SR Legacy dump
    ↓
build-embeddings.ts → adapters/embeddings (same code runtime bot uses) → vector per food
    ↓
load.ts → idempotent upsert into fdc_foods(id, name, embedding, nutrients_per_100g, dataset_version, embedding_model_version)
    ↓
(runtime bot only ever READS fdc_foods; never writes to it)
```

### Key Data Flows

1. **Voice → diary:** one-directional pipeline (STT → LLM → embeddings → vector search → math → storage) with a human-in-the-loop correction detour before the final math/storage step. Nothing after the "confirm" tap touches an external AI API — the last step is pure arithmetic over already-fetched FDC data.
2. **FDC reference data:** written once (or rarely, on dataset refresh) by the offline indexer, read many times by the runtime bot's matching step. This is a one-way, infrequent-write/frequent-read relationship — treat `fdc_foods` as close to read-only from the bot's perspective.
3. **Onboarding → target KБЖУ:** independent of the voice pipeline entirely; pure function of profile fields (sex, age, height, weight, activity, goal, rate) → target calories/macros. No external API calls at all, fully deterministic, highest-confidence part of the system to build and test first.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|---------------------------|
| Closed beta (owner + friends, single-digit users) | Single Node process, in-process async for the voice pipeline (Pattern 2), single Postgres+pgvector instance. No queue, no separate workers. This matches PROJECT.md's stated scope explicitly. |
| Tens–low hundreds of users | Introduce a real queue (BullMQ+Redis) behind the same `enqueue`/`process` seam once (a) a paying subscriber's voice message must not be silently lost on a crash, or (b) concurrent external API calls need rate-limiting/backpressure. `fdc_foods` at ~10-13k rows needs no changes. |
| 100k+ users / Branded Foods added | Reconsider pgvector vs a dedicated vector DB (Qdrant/Pinecone) — TECH_SPEC already flags this correctly (~2M Branded Foods rows is the trigger, not user count per se). Voice pipeline would need dedicated worker processes/horizontal scaling, separate from the webhook-receiving process. |

### Scaling Priorities

1. **First bottleneck:** external API latency/reliability (STT+LLM+embeddings per voice message, several seconds and several failure points), not database or compute — this is why the ack-first + async pattern matters from day one even at tiny scale, independent of whether a "real" queue exists yet.
2. **Second bottleneck (much later):** `fdc_foods` table size/index performance if Branded Foods (~2M rows) is ever added — explicitly out of v1 scope per PROJECT.md, and pgvector's HNSW/IVFFlat indexing still handles this row count fine; the reconsideration point is more about data quality/dedup than raw vector search performance.

## Anti-Patterns

### Anti-Pattern 1: Processing the voice pipeline synchronously inside the webhook HTTP handler

**What people do:** `await` STT → LLM → embeddings → matching all before calling `res.send()` on the webhook route, because it's the simplest code to write first.
**Why it's wrong:** Even at v1 scale, several seconds of sequential external calls risks Telegram re-delivering the update (see Pattern 1), which without idempotency handling means duplicate LLM/embedding spend and potentially duplicate diary entries — a correctness bug, not just slow UX.
**Do this instead:** Ack the webhook immediately; do the pipeline work after responding, guarded by an idempotency check on `update_id`.

### Anti-Pattern 2: Domain logic importing grammY/Telegraf types or a `ctx` object

**What people do:** Write nutrition math or FDC matching functions that take the Telegraf `Context` directly and read/write `ctx.session`, because it's convenient inside a command handler.
**Why it's wrong:** Makes the most important, riskiest logic in the product (per PROJECT.md's Core Value: recognition/calculation accuracy) impossible to unit test without spinning up a fake Telegram context, and impossible to reuse if a second interface (web dashboard, admin tool) is ever added.
**Do this instead:** Domain functions take plain typed inputs (grams, nutrient records, embeddings) and return plain typed outputs; `bot/` translates between Telegram's `ctx` and those plain calls.

### Anti-Pattern 3: Running the FDC indexing pipeline as part of app startup or on a schedule inside the bot process

**What people do:** Wire the "download + embed + load USDA FDC" logic to run automatically on deploy or via a cron inside the same process as the bot, "just in case the data is missing."
**Why it's wrong:** USDA FDC updates infrequently (TECH_SPEC: "раз в несколько месяцев"); running it automatically adds startup latency/failure risk to every deploy, risks accidental re-embedding cost, and couples the bot's uptime to a batch job that has nothing to do with serving a user's voice message.
**Do this instead:** A separate, manually-invoked CLI entrypoint in the same repo (`scripts/index-fdc/`), run deliberately when the dataset needs (re)loading, idempotent (safe to rerun), with the loaded dataset/model version recorded so a mismatch (e.g., embedding model changed) is detectable rather than silently producing bad matches.

### Anti-Pattern 4: Holding correction/draft state in an in-memory session object keyed by chat

**What people do:** Store the "which candidate is currently selected per ingredient" state in a JS `Map` or in-memory session middleware, because grammY/Telegraf session plugins make this the path of least resistance.
**Why it's wrong:** State is lost on process restart/deploy (common during active early development), and does not survive if the process is ever scaled beyond one instance.
**Do this instead:** Persist the draft (Pattern 4 above) as a row in Postgres from the moment the confirm/correct card is first sent; callback_query handlers read/update that row, not an in-memory object.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|----------------------|-------|
| Telegram Bot API | Webhook (inbound updates) + outbound `sendMessage`/`editMessageReplyMarkup` calls via Bot API | Webhook handler must ack fast (Pattern 1); outgoing "Секунду, разбираю" and result cards are separate API calls made after ack, not part of the webhook response body |
| STT provider (Whisper/Yandex/Google — open per TECH_SPEC §11) | Adapter implementing a `transcribe(audioBuffer) → text` interface | Delete/discard the audio file after successful transcription per PROJECT.md privacy constraint; keep only the transcript |
| LLM provider (structured output/function calling) | Adapter implementing `decompose(text) → {items:[...]}`, schema-validated | Must use the model's structured-output/function-calling mode, not prompt-only JSON, per TECH_SPEC §5.3; validate against a schema before use, retry once on invalid output, else surface a "не смог разобрать" message |
| Embedding provider (gemini-embedding-001 or OpenAI text-embedding-3-small — open per TECH_SPEC §11) | Adapter implementing `embed(text) → number[]`, shared verbatim between runtime matching and the offline indexer | The embedding model used to index `fdc_foods` and the one used at query time must be the same model/version — record the model version alongside indexed rows (see Anti-Pattern 3) |
| USDA FoodData Central dataset | One-time/rare download of Foundation Foods + SR Legacy dump, consumed only by `scripts/index-fdc/` | Not a live API call at runtime — the runtime bot only queries the already-indexed local `fdc_foods` table |
| (Deferred) Payment acquirer (e.g., Kaspi Pay) | Separate public webhook endpoint, signature-verified, flips `subscriptions.status` only on confirmed callback | TECH_SPEC §7.2 already specifies this correctly; architecturally additive, does not touch the voice pipeline |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|-----------------|-------|
| `bot/` ↔ `application/` | Direct function calls (same process) | `bot/` translates Telegram update/callback into a plain call; no Telegram types cross into `application/` |
| `application/` ↔ `domain/` | Direct function calls, domain exposes ports (interfaces) that `application/`/`adapters/` implement | Enables unit testing `domain/` with fakes, per Pattern 3 |
| `application/` ↔ `adapters/` (STT, LLM, embeddings) | Direct async calls through narrow interfaces, one adapter module per provider | Swappable per TECH_SPEC's open provider questions without touching orchestration logic |
| Runtime bot ↔ `fdc_foods` table | Read-only queries (vector search) | Bot process never writes to this table; only `scripts/index-fdc/` writes to it |
| Voice pipeline ↔ (future) queue | Currently in-process async call; designed as a swappable seam (`enqueue`/`process`) | See Pattern 2 — do not build BullMQ/Redis for v1, but do not hardcode assumptions that block adding it later |
| Voice pipeline ↔ (future) payment/notification workers | None at v1 — those are separate, additive components reading the same Postgres tables (`subscriptions`, `users`) | Confirms TECH_SPEC's phase deferral is architecturally sound: neither deferred component sits on the critical path of STT→LLM→matching→math |

## Suggested Build Order (dependency-driven)

This is the dependency graph implied by the component boundaries above, translated into a build sequence a roadmap can use directly:

1. **Postgres schema + `fdc_foods` table + pgvector extension.** Nothing else can be tested end-to-end without this existing, even with fixture data.
2. **Offline FDC indexing pipeline (`scripts/index-fdc/`).** Decoupled from the bot entirely — can be built, run, and validated (spot-check known foods return sensible candidates) before a single line of Telegram code exists. Also the natural place to first validate the chosen embedding provider (TECH_SPEC §11 open question) since it has no Telegram dependency to get in the way.
3. **Domain layer: nutrition calculation (BMR/TDEE/target) and FDC matching (`domain/`).** Zero external-service dependency for nutrition calc; FDC matching depends only on step 1-2's data being present and an embedding adapter existing. Fully unit-testable in isolation — this is where the product's core accuracy risk (per PROJECT.md Core Value) gets validated first, cheaply, without needing Telegram running at all.
4. **STT/LLM adapters, tested standalone** (pass a sample audio file / sample transcript through each adapter in isolation) before wiring into the orchestrator.
5. **Telegram bot skeleton:** webhook handler with ack-first pattern (Pattern 1), `/start`, onboarding flow calling the already-built nutrition domain functions. This is the first point real Telegram interaction exists, and it only depends on step 3 (onboarding needs no AI pipeline at all) — a good candidate for an early demo-able phase.
6. **Voice pipeline orchestration wiring:** connect STT → LLM → per-ingredient embed/match (steps 2-4) behind the ack-first async pattern, with the "Секунду, разбираю" immediate feedback message.
7. **Confirm/correct UI + `diary_draft` persistence (Pattern 4) + final deterministic aggregation + diary write.** Depends on everything above being wired.
8. **(Explicitly deferred, later milestone):** payment webhook receiver and notification scheduler. Per the Internal Boundaries table, both are additive against the same Postgres schema and do not require revisiting any component built in steps 1-7 — confirms PROJECT.md's phase deferral decision is not just a scope choice but also an architecturally clean cut point.

**Build-order rationale:** the sequence intentionally front-loads the two hardest-to-verify, most product-critical pieces — FDC indexing/matching quality and nutrition math correctness — before any Telegram UI exists, because both are independently and cheaply testable in isolation (scripts/unit tests), and PROJECT.md's Core Value is explicit that recognition/calculation accuracy, not UI polish, is what makes or breaks this product.

## Sources

- [Long Polling vs. Webhooks | grammY](https://grammy.dev/guide/deployment-types.html) — MEDIUM confidence, corroborates need to ack webhooks quickly
- [Telegram webhook mode times out for LLM-backed bots · Issue #8907](https://github.com/openclaw/openclaw/issues/8907) — community-reported retry behavior, MEDIUM confidence (not official docs)
- [Telegram webhook mode: missing onTimeout causes cascading 500s and retry storms · Issue #16763](https://github.com/openclaw/openclaw/issues/16763) — corroborates retry-storm risk from slow/erroring webhook handlers
- [core.telegram.org/bots/webhooks](https://core.telegram.org/bots/webhooks) — official docs; checked directly, does NOT publish an exact response-time/retry threshold (flagged honestly rather than asserting an unverified number)
- Hexagonal Architecture / Ports and Adapters — general pattern, HIGH confidence (well-established, Alistair Cockburn 2005; verified applicability to bot-as-adapter scenario via multiple independent sources)
- pgvector indexing pipeline separation (bulk load → build/rebuild index) — general pattern from pgvector ecosystem guides, MEDIUM confidence
- `TECH_SPEC.md` (this repo) §4-5 — primary source; this document validates and extends rather than contradicts it

---
*Architecture research for: Telegram bot + multi-step AI pipeline + vector search over reference dataset*
*Researched: 2026-08-10*
