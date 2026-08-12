# Phase 3: Voice pipeline - Context

**Gathered:** 2026-08-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The riskiest AI chain in the product, wired end to end for the first time: a
Telegram **voice** or **text** message describing a meal is acknowledged
immediately, transcribed via STT, decomposed by an LLM into components with
English names and gram estimates, and each component is matched against the
already-indexed USDA FDC data for 3 candidates — all of it idempotent against
duplicate/retried updates.

Covers VOICE-01..04, DECOMP-01..03.

**Explicitly NOT in this phase:** the confirm/correct card with inline
keyboards (`▾` candidate picker, ±10 g, remove/add component), the final
deterministic КБЖУ calculation, the diary write, diary views, payments,
reminders, deployment to a hosting provider.

The phase ends with a **read-only text card** — same information the Phase 4
card will carry, minus the buttons — and a **persisted draft row** that Phase
4 will attach its keyboard to.

</domain>

<decisions>
## Implementation Decisions

### Speech-to-text

- **D-01: Beta users speak Russian with Kazakh dish names in it** — not full
  Kazakh sentences ("русский + бешбармак/куырдак/казы"). This reframes the
  problem the STATE.md blocker described: it is **not** a Kazakh-STT problem,
  it is a rare-vocabulary problem inside Russian speech, plus a decomposition
  problem (FDC has no "beshbarmak" record — the LLM must break it into lamb /
  dough / onion). Full-Kazakh speech is out of scope for the beta.
- **D-02: OpenAI is the STT provider for Phase 3**, reached through a
  `Transcriber` port in the hexagonal style already used for `Embedder` /
  `FdcRepository`. Rationale: the OpenAI account, key and hard spend cap
  already exist from Phase 1 (01-CONTEXT D-02) — zero new cloud accounts,
  zero new billing for a backend-inexperienced owner. **Yandex SpeechKit is
  not rejected**, it is deferred to a one-adapter swap if D-01 turns out to
  be wrong. The port must be the only thing the pipeline knows about.
- **D-03: Model is `gpt-4o-mini-transcribe`, held in a single constant/env
  var**, not scattered through the code. ⚠ Noted disagreement, recorded and
  overridden by the owner deliberately: at ~10-second voice messages the
  saving over `gpt-4o-transcribe` is ≈$0.0005 per message (effectively
  nothing), while mini's known weakness is rare words — exactly the Kazakh
  dish names D-01 identifies as the risk. Because the choice is one string,
  `verify-stt` (D-04) must transcribe each sample with **both** models and
  print the two texts side by side, so the decision gets settled by the
  owner's real recordings rather than by argument. Default stays mini.
- **D-04: Success criterion 2 is satisfied by `npm run verify-stt`**, in the
  established Phase 1 `verify-*` house style (plain-Russian output, explicit
  "what to do next"). The owner drops ~10 of their own voice files into a
  **gitignored** folder; the script transcribes each and prints the text plus
  the estimated cost. Not part of the bot process, no Telegram involved.
- **D-05: Audio is never written to disk and never logged** (TECH_SPEC §10).
  The file is streamed from Telegram into memory, handed to STT, and dropped.
  The **transcript is persisted** (it is needed by Phase 4 and it is the only
  way to tell an STT error from an LLM error after the fact). Storing users'
  raw audio to build a test corpus was explicitly rejected.
- **D-06: Accepted input is `voice` messages and plain `text` only** — exactly
  VOICE-01 and VOICE-04. `audio` files, `video_note` (кружочки), photos,
  documents and stickers get a short polite Russian refusal and cost nothing.
- **D-07: No STT prompt glossary yet.** The adapter exposes an optional
  prompt parameter (the seam), but it starts empty; words get added only
  against concrete misrecognitions seen in `verify-stt`, not by guessing
  which dish names might break.
- **D-08: "No food in the message" is a normal answer, not a failure.** If
  the LLM returns an empty component list for "привет, как дела" or for
  silence, the bot replies in Russian ("не услышал еды — опиши, что ты съел")
  and **does not** spend a second retry on it. This is a deliberate carve-out
  from DECOMP-03's "empty result → retry": retry is for *malformed* output,
  not for a well-formed empty one. No pre-LLM length heuristic — it would
  also swallow an honest "банан".

### Run mode, idempotency, in-flight UX

- **D-09: Phase 3 stays on grammY long polling on the owner's machine.**
  This **revises Phase 2's D-02**, which expected hosting + `setWebhook` here.
  Reasons: (a) polling has no webhook timeout, so the argument that forced
  ack-first for webhooks does not create a deployment deadline; (b) Phase 3
  is already the highest-risk phase in the project (STT + LLM + matching in
  one chain) and stacking the owner's first-ever deployment on top of it puts
  two unfamiliar failure sources in the same debugging session. The
  `createBot()` / entrypoint seam from Phase 2 stays untouched, so the flip is
  still a transport-only change later.
- **D-10: Idempotency via a `processed_updates` table keyed on Telegram
  `update_id`.** The row is inserted **before any paid call**; a unique-key
  conflict means "already handled" and the handler returns silently. Chosen
  over an in-memory Set (dies with the process — i.e. fails in exactly the
  crash-restart case it exists for) and over keying on `(chat_id,
  message_id)` (that is the draft's key, a different concern). Works
  unchanged under webhook later.
- **D-11: The row carries a status.** On startup the bot finds rows still in
  `processing` — the fingerprint of a crash or a closed terminal mid-pipeline
  — and tells that user in Russian that the analysis was interrupted and to
  send the message again. It does **not** auto-resume: the audio is gone by
  design (D-05), so a resume is only partially possible and not worth the
  complexity in a closed beta.
- **D-12: Three voice messages in a row are all processed.** Sending
  breakfast, lunch and dinner back to back is honest usage, not abuse.
  Runaway spend is bounded by the limits in D-14/D-15, not by refusing or
  serializing input. No per-user in-process queue (that is half a job queue,
  and the roadmap decided against one for v1).
- **D-13: One message, edited in place.** The bot sends "Секунду, разбираю 🎧"
  (VOICE-02) as a single message and, when processing finishes, **edits that
  same message** into the result. Keeps the chat readable at 3-6 meals/day and
  hands Phase 4 a stable `message_id` to hang its inline keyboard on. No
  per-step status edits (extra Telegram calls for little benefit).

### Cost control

- **D-14: Audio is capped at 60 seconds**, checked against the `duration`
  field Telegram already puts in the update — i.e. **before** the file is
  downloaded and before any paid call. Over the cap → polite Russian refusal
  asking for a shorter message. This is the main defence against the real
  outlier risk (an accidentally held microphone button), not against average
  spend: a typical message costs ≈$0.002 all-in.
- **D-15: Soft per-user cap of ~30 processed messages per day**, the number in
  a constant/env var. This is a runaway guard (a loop, a stuck client), not a
  tariff — subscription limits are explicitly v2. Exceeding it produces a
  friendly Russian message, not a hard error.
- **D-16: Decomposition runs through the Vercel AI SDK** (`generateObject` +
  Zod schema, per STACK.md and TECH_SPEC §5.3) against OpenAI — the same
  account and spend cap as STT and embeddings, so the owner has one bill and
  one key to reason about. The Zod schema *is* the DECOMP-03 validator. Model
  name lives in a constant, as in D-03.
- **D-17: One cost line per processed message in the terminal** — STT
  seconds, LLM tokens, embedding count, estimated dollars. Deliberately
  cheap: no spend table, no dashboard. It makes an anomaly visible the same
  day instead of at the end of the month, and matches the plain-Russian
  operator-output style of `check-setup` / `verify-*`. A persisted spend
  ledger for real unit economics (TECH_SPEC §9) waits for the payment
  milestone.

### What the phase produces

- **D-18: The result is a read-only text card, no inline keyboard.** Same
  content Phase 4's card will show — component, grams, matched FDC record —
  so Phase 4 adds buttons to an existing formatter instead of replacing one.
  Building the buttons now was explicitly rejected as pulling Phase 4 into
  Phase 3 and blurring both phases' acceptance criteria. Showing all 3
  candidates plus similarity scores was also rejected: it reads as a debug
  dump, not a product.
- **D-19: The draft IS persisted to Postgres in Phase 3.** Phase 4 needs a
  DB-backed draft anyway (ARCHITECTURE.md Anti-Pattern 4 — never hold
  correction state in process memory), so writing it here means Phase 4
  extends a table instead of rewriting Phase 3's ending. The row holds the
  transcript, the components with grams, and the matched candidates.
  Phase 4 owns any further schema evolution of that table.
- **D-20: No КБЖУ numbers in the Phase 3 card.** The card shows components,
  grams and the matched FDC record only. Nutrient arithmetic is CALC-01, i.e.
  Phase 4 — and numbers displayed *before* the user has confirmed anything
  would read as final results while still being unconfirmed guesses.
- **D-21: A weak FDC match is shown, flagged, never silently dropped.** If the
  best candidate's similarity is poor, the component still appears in the card
  with a visible "совпадение слабое, проверь" marker. Dropping the component
  would make calories vanish from the dish with no explanation; rejecting the
  whole analysis over one bad component would be maddening on a complex dish.
  Phase 4's picker is where the user actually fixes it.

### Claude's Discretion

The following were not discussed and are the planner's call, within the
constraints above:

- **The decomposition prompt itself** — including how composite Central Asian
  dishes (бешбармак, куырдак, плов, манты) get broken into FDC-findable
  ingredients, and how an explicitly stated weight ("200 г риса", TECH_SPEC
  §5.2) overrides the model's portion estimate. This is the single biggest
  accuracy lever in the phase; treat it as such, and put its expectations in
  tests rather than in prose.
- **The DECOMP-03 retry** — one retry with a stricter prompt on
  schema-invalid output, then the user-facing "не смог разобрать, опиши
  иначе" (roadmap success criterion 4). Note the D-08 carve-out: a
  well-formed empty result is not a retry trigger.
- **Retry/backoff for transient network or 429 failures** from OpenAI, and
  the user-facing Russian text for each terminal failure mode (STT failed,
  LLM failed twice, DB unavailable). Follow the existing Russian,
  actionable-error house style.
- **Embedding calls for components** — batching, and whether to cache repeat
  ingredient strings. Hard constraint: runtime embedding **must** use the
  exact model and dimension count that indexed `fdc_foods`
  (`text-embedding-3-large` truncated to 1536 dims, 01-CONTEXT D-02 as
  amended) — a mismatch silently destroys retrieval quality.
- **File layout** under `src/application/` (the `enqueue`/`process` seam),
  `src/adapters/stt/`, `src/adapters/llm/`, `src/bot/handlers/`, plus the
  Drizzle migrations for `processed_updates` and the draft table. Migration
  workflow is locked by Phase 1: `drizzle-kit generate` + `migrate` only,
  `push` is banned, and the owner reviews the SQL before it is applied.
- **Test strategy** — the Phase 1/2 pattern holds: pure logic (schema
  validation, gram parsing, card formatting, limit checks, idempotency
  decision function) unit-tested with Vitest against fakes; anything touching
  a real API verified by a `verify-*` script or by hand.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec & scope
- `TECH_SPEC.md` §3.3 — the main voice → diary flow, including the exact
  shape of the card the user gets back
- `TECH_SPEC.md` §5.1 — STT provider options and the reasoning behind them
- `TECH_SPEC.md` §5.2 — the decomposition contract: strict JSON, composite
  dishes broken to ingredients, single-ingredient dishes staying single, and
  explicit user-stated grammage winning over the model's estimate
- `TECH_SPEC.md` §5.3 — schema validation via structured output, retry, and
  the user-facing failure message
- `TECH_SPEC.md` §5.4 — `component_en` is produced by the same LLM call, not
  by a separate translation step
- `TECH_SPEC.md` §5.8 — missing sugar is "нет данных", never 0 (relevant to
  what the card may display)
- `TECH_SPEC.md` §10 — audio is sensitive data; do not keep files longer than
  transcription needs (source of D-05)
- `.planning/ROADMAP.md` → "Phase 3: Voice pipeline" — goal and the five
  success criteria this phase is graded against
- `.planning/REQUIREMENTS.md` — VOICE-01..04, DECOMP-01..03
- `.planning/PROJECT.md` — Core Value (accuracy is the product) and Key
  Decisions

### Architecture & stack
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (ack-first), Pattern 2
  (queue is a seam, not a v1 dependency — build `enqueue`/`process`),
  Pattern 3 (ports and adapters), Pattern 4 + Anti-Pattern 4 (draft state in
  Postgres, never in process memory), and the "Voice message flow" data-flow
  diagram
- `.planning/research/STACK.md` — Vercel AI SDK `generateObject` + Zod for
  structured output, OpenAI SDK used directly for embeddings/STT, grammY
- `.planning/research/PITFALLS.md` — implementation traps
- `.planning/research/SUMMARY.md` — the reconciled in-process-async decision

### Prior phase decisions
- `.planning/phases/01-foundation-data-domain-math/01-CONTEXT.md` — D-02
  (OpenAI account + hard spend cap), and the amendment switching the
  embedding model to `text-embedding-3-large` @1536 dims
- `.planning/phases/02-bot-skeleton-onboarding/02-CONTEXT.md` — D-02 (the
  start-mode seam, **revised here by D-09**), D-03 (one bot, one token),
  D-04..D-07 (fail-closed allowlist), D-08/D-09 (verification style)
- `.planning/STATE.md` → "Decisions" and "Blockers/Concerns" — including the
  STT-provider flag this discussion closes, and the `fdc-repository`
  `ORDER BY cosineDistance` invariant that must not be broken by new
  query code

### Project rules
- `CLAUDE.md` — the owner has no backend experience: every setup step must be
  written out literally; and never agree by default — flag risky choices
  before implementing them

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/domain/fdc-matching/index.ts` — `matchIngredient()`, the
  `FdcRepository` port, `FdcCandidate`, `CANDIDATE_COUNT = 3`,
  `ALLOWED_SOURCES`. This is the **only** entry point for matching; Phase 3
  is the consumer its barrel comment was written for. Do not re-implement
  ranking or re-query pgvector by hand.
- `src/adapters/fdc-repository.ts` — the Drizzle/pgvector implementation.
  Invariant from Phase 1: `findNearest` must `ORDER BY` the raw
  `cosineDistance` expression ascending — ordering by a computed similarity
  alias descending silently defeats the HNSW index and falls back to a Seq
  Scan.
- `src/adapters/embeddings/openai-embed.ts` + `types.ts` — the `Embedder`
  port and its OpenAI implementation, already shared with the offline
  indexer. Runtime component embedding must go through this, at the same
  model/dimensions the index was built with.
- `src/bot/bot.ts` — the composition root. Registration order is load-bearing
  and asserted by `bot.wiring.test.ts` (allowlist → session → conversations →
  conversation → commands). New voice/text handlers register **after** the
  allowlist gate, so a non-allowlisted user can never trigger a paid call.
- `src/bot/telegram/ack.ts` — `ack()`, the swallow-on-stale-callback helper.
  Phase 4 will need it more, but the reasoning (a button in chat history is
  tapped a day later) already applies to anything Phase 3 leaves on screen.
- `src/bot/error-handler.ts` — logs a short Russian line and never the whole
  update object (message text is health data here) and never the token. Any
  new logging in the pipeline must hold that invariant.
- `src/config/env.ts` — `loadEnv()`, `REQUIRED_ENV_KEYS`, `OPTIONAL_ENV_KEYS`.
  The only place allowed to read `process.env`. Any new key must be added
  here **and** to `.env.example` — `env.test.ts` asserts they stay in sync,
  and dotenv-safe fails startup on a declared-but-empty required key.
- `src/db/client.ts` — `createDb()` / `closeDb()`. The pipeline uses this, it
  does not open its own pool.
- `scripts/index-fdc/verify-matches.ts` and `scripts/verify-schema.ts` — the
  template for `verify-stt` (D-04): plain-Russian output, explicit next step
  on failure, runnable via an npm script.

### Established Patterns
- Hexagonal: `src/domain/**` imports no Telegram, no DB driver, no OpenAI.
  New external services (STT, LLM) arrive as ports with adapters, matching
  how `Embedder` and `FdcRepository` were done.
- Nothing reads `process.env` directly; nothing connects to the DB at module
  import time (so importing a module in a test never needs `.env`).
- ESM with `.js` import specifiers, `tsx` to run TypeScript, Vitest for
  tests, npm scripts as the owner's entire interface.
- User-facing and operator-facing text is Russian and actionable.
- Migrations: `drizzle-kit generate` + `migrate`, `push` banned, separate
  reviewable migrations, RLS applied, owner reviews SQL before `db:migrate`.

### Integration Points
- New handlers attach to the existing `createBot()` in `src/bot/bot.ts`,
  after the allowlist middleware.
- Two new tables: `processed_updates` (D-10/D-11) and the draft table
  (D-19) — both need generated migrations + RLS, following the Phase 1/2
  workflow.
- `fdc_foods` gets its first **runtime** reads (Phase 1 only wrote and
  spot-checked it via scripts).
- Phase 4 attaches its inline keyboard to the message Phase 3 edits (D-13)
  and extends the draft row Phase 3 writes (D-19).

</code_context>

<specifics>
## Specific Ideas

- The owner's framing of the language question is the most load-bearing
  detail in this discussion: "русский + вкрапления казахского". Any plan that
  treats this as a Kazakh-STT problem (and therefore reaches for Yandex
  SpeechKit, a second cloud account, and a comparison spike) is solving the
  wrong problem. The real work is downstream — teaching the decomposition
  prompt that "бешбармак" is lamb + boiled dough + onion, because FDC has no
  record for the dish itself.
- The owner chose the cheaper transcription model against the recommendation.
  The resolution is deliberately empirical rather than rhetorical: make the
  model a one-line constant and make `verify-stt` print both models'
  transcripts for the same audio. Do not quietly implement the more expensive
  model instead.

</specifics>

<deferred>
## Deferred Ideas

- **`verify-pipeline` — a script covering audio → transcript → components →
  FDC candidates in one report, with no Telegram involved.** Offered and not
  taken; only `verify-stt` was chosen. Worth revisiting in Phase 4, when
  end-to-end accuracy (the product's Core Value) is what actually needs
  measuring.
- **Yandex SpeechKit adapter** — for genuine full-Kazakh speech. Blocked on
  D-01 turning out to be wrong; costs one adapter behind the existing port.
- **Kazakh dish-name glossary in the STT prompt** — the seam exists (D-07),
  the list stays empty until `verify-stt` shows real misrecognitions.
- **Deployment to a hosting provider + `setWebhook`** — deferred a second
  time (D-09, revising Phase 2 D-02). The trigger is beta users needing the
  bot up without the owner's terminal open.
- **Persisted spend ledger / unit economics per user** (TECH_SPEC §9) —
  Phase 3 only prints a per-message cost line (D-17). Real per-tariff
  accounting belongs to the payment milestone.
- **Per-user message limits as a subscription tariff** — D-15 is a runaway
  guard only; tariff limits are explicitly v2.
- **BullMQ/Redis job queue** — unchanged from the roadmap decision: build the
  `enqueue`/`process` seam, do not build the queue.

</deferred>

---

*Phase: 3-Voice pipeline*
*Context gathered: 2026-08-12*
