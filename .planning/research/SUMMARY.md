# Project Research Summary

**Project:** VoxBite
**Domain:** Telegram voice-logging bot with LLM dish decomposition + USDA FDC embedding search (voice-first nutrition/calorie tracker)
**Researched:** 2026-08-10
**Confidence:** MEDIUM-HIGH

## Executive Summary

VoxBite is a voice-first nutrition diary: a Telegram bot that turns a spoken description of a meal into a structured, ingredient-level diary entry via STT → LLM decomposition → embedding-based match against USDA FoodData Central → deterministic math. Experts build this class of system (webhook-driven bot + multi-step AI pipeline + reference-data vector search) as a hexagonal/ports-and-adapters architecture: a thin Telegram adapter layer, a framework-agnostic orchestration layer, and a pure, fully unit-testable domain layer for nutrition math and FDC matching — with every external AI provider (STT, LLM, embeddings) hidden behind a narrow, swappable interface. The recommended stack (grammY, Postgres+pgvector, Drizzle, Vercel AI SDK + Zod structured outputs) is mainstream, low-operational-overhead, and matched to a TypeScript-fluent, backend-inexperienced solo owner — it deliberately avoids a second infrastructure dependency (dedicated vector DB) at this data scale (~10-13k FDC rows) and avoids provider lock-in for the least-certain choices (STT provider, embedding model).

The single biggest risk is not the stack — it's silent accuracy failure in the AI pipeline: unvalidated LLM JSON, hallucinated gram estimates, and (most severe) raw-vs-cooked FDC mismatches that can shift calorie/macro output by 15-40% while looking completely plausible. These are the pitfalls most directly threatening the Core Value ("accuracy over payment/growth features") and must be designed for from the first pipeline build, not patched in later. A second cluster of risk is operational hygiene for a first-time backend developer: idempotency (Telegram's at-least-once webhook delivery), persisted (not in-memory) correction-draft state, secrets handling, and cost guardrails — all cheap to build correctly from day one and expensive to retrofit.

Feature-wise, the currently-scoped v1 (voice log → confirm/correct → save, onboarding, daily view, disclaimer) is directionally correct and already ahead of competitors on its core differentiator (auto ingredient decomposition + verified-database math vs. Cal AI's pure-AI-guess approach), but has four table-stakes gaps worth closing before calling v1 "done": editing/deleting an already-saved diary entry, a lightweight weekly/multi-day view, timezone capture at onboarding, and manual/text entry as an equal (not fallback) input — all four are low-cost extensions of work already planned, not new subsystems.

## Key Findings

### Recommended Stack

Node.js 22/24 LTS + TypeScript 5.9 (matches the owner's existing React/TS skillset — the single highest-leverage decision for a backend-inexperienced solo owner) with grammY as the Telegram framework (over Telegraf, specifically for `@grammyjs/conversations` and `@grammyjs/menu`, which map directly onto the onboarding flow and candidate-picker UX). Postgres 17 + pgvector is the datastore for everything — users, diary, subscriptions, and the FDC vector index — deliberately avoiding a second vector-DB service at ~10-13k records (pgvector/HNSW comfortably handles up to ~1M vectors; the documented fallback trigger is the ~2M-row Branded Foods dataset, explicitly out of v1 scope). Drizzle ORM is recommended over Prisma for staying close to raw SQL, which matters when debugging `ORDER BY embedding <=> $1` queries. Dish decomposition uses the Vercel AI SDK's `generateObject()` with a Zod schema against provider-native structured outputs (not prompt-only JSON) — provider-agnostic and doubles as the runtime validator.

**Core technologies:**
- grammY 1.45.x — Telegram bot framework — official conversations/menu plugins fit onboarding + candidate-picker UX directly
- PostgreSQL 17 + pgvector 0.8.x — single datastore for relational + vector data — no second service to operate
- Drizzle ORM 0.45.x — TypeScript-first DB access — stays close to SQL for debuggability of vector queries
- Vercel AI SDK (`ai` 7.0.x) + Zod 4.4.x — structured-output LLM calls — schema is simultaneously validator and TS type
- **STT provider — Yandex SpeechKit recommended, MEDIUM confidence** — only provider with documented native Kazakh + mixed RU/KZ code-switching support; flagged for a real-audio validation spike early in Phase 1 before locking in (per TECH_SPEC's own open question)
- `text-embedding-3-small` (OpenAI) — embedding model — sufficient given the LLM pipeline already translates ingredients to English before embedding, so multilingual embedding quality (gemini-embedding-001's selling point) isn't the relevant capability

### Reconciled Recommendation: Background Job Processing (Queue vs. In-Process Async)

STACK.md and ARCHITECTURE.md disagree on this point, and it needs an explicit call rather than silent pick:

- **STACK.md recommends adopting BullMQ from Phase 1**, reasoning that retrofitting a queue later (moving business logic into a worker function) is exactly the kind of rework a backend-inexperienced owner will find painful, and that a 4-5-step external-API chain per voice message is worth queuing from day one.
- **ARCHITECTURE.md recommends an in-process async seam for v1** (ack-first webhook handling, fire-and-forget async processing, no Redis/BullMQ dependency), with BullMQ as a swappable drop-in once (a) beta grows past "a few friends," (b) work must survive a process restart, or (c) concurrent API calls need real backpressure/rate-limiting.

**Roadmap should follow ARCHITECTURE.md: in-process async for v1, BullMQ deferred.** Rationale: this is a closed beta for the owner + friends — single-digit users, not a queue-engineering exercise, and PROJECT.md explicitly scopes payment/scale concerns out of v1. The concrete risk BullMQ protects against (a crashed process silently losing a job mid-pipeline) is real but low-probability and low-cost at this scale — worst case is a friend resends a voice message. Standing up and operating Redis (even managed/free-tier) is a second infrastructure dependency and a second thing to learn/monitor for a backend-inexperienced solo owner, for a durability guarantee that isn't yet load-bearing. What **is** non-negotiable regardless of which side wins: the orchestrator (`application/voice-pipeline.ts`) must be written as a clean `enqueue`/`process` seam from day one, with idempotency (Telegram `update_id`) and persisted (not in-memory) draft state — so that adding BullMQ later is a swap of the seam's implementation, not a rewrite of STT/LLM/matching logic. Revisit this decision explicitly once either (a) real (even friend) users report lost/duplicate processing, or (b) a paid-subscriber phase begins — at that point BullMQ moves from "nice to have" to "the STACK.md recommendation was right all along."

**Supporting libraries:** `@grammyjs/conversations`/`@grammyjs/menu` for onboarding and candidate-picker; `csv-parse` for the one-time FDC bulk-indexing script; Vitest for unit-testing the nutrition math (BMR/TDEE/aggregate) that is the product's core-value-critical, easiest-to-test layer.

### Expected Features

Current Active scope (voice log → confirm/correct → save, onboarding, daily view, disclaimer) is directionally sound and already differentiated (auto ingredient decomposition + verified-DB math beats Cal AI's pure-AI-guess model, which reviewers cite as its core weakness). Research surfaces four table-stakes gaps not currently in Active scope, all low-cost extensions of already-planned mechanics.

**Must have (table stakes, recommend adding to v1):**
- Edit/delete an already-saved diary entry — reuses the existing pre-save correction UI/logic; every competitor (MFP, Cronometer, MacroFactor, Cal AI) supports this and its absence breaks trust fast
- Timezone capture at onboarding — needed for correct "today" day-boundary math, independent of the deferred reminders feature
- Manual/text entry as an equal input alongside voice — reuses the same STT-output → LLM decomposition pipeline at near-zero marginal cost; voice-only fails in noisy/public contexts
- Simple weekly/multi-day summary (text table, no charts needed) — makes the daily loop meaningful over time; every competitor reviewed surfaces some multi-day view

**Should have (differentiators, already scoped — protect, don't dilute):**
- Voice-first, hands-free logging — the product's identity; don't let text-entry become "the real" primary mode
- Automatic ingredient-level decomposition of composite dishes — the single biggest technical differentiator vs. Cal AI's lump-estimate approach
- Structured 3-candidate tap-to-swap correction — lower friction than both Cal AI's "just re-type it" and MFP/Cronometer's full database search
- Transparent uncertainty (missing sugar shown as "no data," never 0 or guessed) — directly protects credibility against the "false precision" trap other trackers fall into

**Defer (v1.x / v2+):**
- Periodic weight re-entry + target recalculation — v1.x, once 2+ weeks of usage makes "did the plan work" a real question
- Pregnancy/breastfeeding onboarding safety gate — v1.x, cheap safety addition given the existing calorie-floor logic; before any expansion past the closed friends-and-owner beta
- Personal correction memory, barcode scanning, photo-based logging, adaptive TDEE, wearable sync — v2+, all either conflict with current dataset scope (Branded Foods), dilute the voice-first identity, or add complexity disproportionate to validating the core hypothesis
- **Explicit anti-features to keep out permanently:** color-coded food judgment, shame-based streaks/warnings, AI "coach" advice-giving — all documented as trust-eroding or legally risky in comparable apps (Noom), and directly conflict with VoxBite's "calculator, not coach" + non-medical-device positioning

### Architecture Approach

Hexagonal/ports-and-adapters: a `bot/` layer holding all Telegram-specific code (grammY types, message formatting, inline keyboards), an `application/` orchestration layer with zero Telegram or DB-driver imports, and a `domain/` layer (nutrition math, FDC matching) that is pure, dependency-free, and fully unit-testable with fakes — no network calls, no Telegram mocks required to test the product's core accuracy logic. External AI providers (STT, LLM, embeddings) each sit behind a narrow one-method interface so TECH_SPEC's still-open provider questions (Yandex vs. Whisper, embedding model) become config + one new adapter file, not a rewrite.

**Major components:**
1. Bot layer (webhook handler, onboarding conversation, inline keyboards/callbacks) — the only place grammY types appear; ack-first webhook handling is non-negotiable (Telegram re-delivers slow/erroring webhooks)
2. Application orchestrator (voice pipeline sequencing, onboarding flow) — the swappable async/queue seam discussed above
3. Domain layer (nutrition calc: BMR/TDEE/aggregate math; FDC matching: embedding → candidate ranking) — pure functions, the most product-critical and most cheaply testable part of the system
4. Adapters (STT, LLM, embedding clients; Postgres/pgvector repository) — one narrow interface per external dependency, swappable via config
5. Offline FDC indexing pipeline (`scripts/index-fdc/`) — separate CLI entrypoint sharing code with the runtime bot but never invoked by a request; run once/rarely on dataset refresh

**Suggested build order (dependency-driven, from ARCHITECTURE.md):** Postgres schema + pgvector → offline FDC indexing pipeline (validate embedding provider choice with zero Telegram dependency) → domain layer (nutrition math + FDC matching, fully unit-testable) → STT/LLM adapters tested standalone → Telegram bot skeleton (webhook + onboarding) → voice pipeline orchestration wiring → confirm/correct UI + draft persistence + final diary write. This front-loads the two hardest-to-verify, most product-critical pieces (matching quality, math correctness) before any Telegram UI exists.

### Critical Pitfalls

1. **Raw-vs-cooked FDC mismatch (most severe)** — embedding similarity captures "what food" but not "in what state," and a raw/cooked mismatch can silently shift calorie output by 15-40% while looking plausible. Avoid by having the LLM tag a best-effort `state` field per component, defaulting to as-eaten/cooked weight assumptions, and surfacing the FDC description's stated state visibly in the candidate card so the user's correction step can catch it.
2. **Unvalidated LLM JSON output** — "structured output" guarantees shape, not correctness; a syntactically valid response can still have an empty `items` array or a string where `grams` should be numeric. Avoid with provider-native structured output + Zod validation + field-level sanity bounds + graceful failure on second validation failure.
3. **No idempotency on voice processing** — Telegram webhooks are at-least-once delivery; without an idempotency key (`update_id`) a retried webhook produces duplicate LLM/STT spend or duplicate diary entries. This is foundational plumbing, not an edge case, and must exist before the correction UX is built on top of it.
4. **In-memory correction/draft state** — Telegram callback_query for "pick candidate 2 of 3" can arrive minutes later or after a restart; state must be a Postgres row keyed by draft ID from the start, not a JS Map, and `callback_data` must stay a short opaque reference (64-byte hard limit), never encoded rich state.
5. **Missing nutrient fields (sugar) coerced to zero** — directly contradicts an explicit, already-identified product requirement (TECH_SPEC §5.8); model missing data as `null`/"нет данных" all the way through aggregation, never `COALESCE(sugar, 0)`.

Additional early-phase-critical items worth flagging: secrets hygiene + cost guardrails (per-user quota enforced server-side + provider spend caps) must exist before any beta user gets access, not be deferred to the payments phase; and pipeline observability (structured logs per stage with a shared request ID) is the primary debugging tool a non-backend developer will have.

## Implications for Roadmap

Based on combined research, suggested phase structure:

### Phase 1: Foundation — data + domain math (no Telegram, no AI providers yet)
**Rationale:** Architecture research explicitly recommends front-loading the hardest-to-verify, most product-critical pieces before any Telegram UI exists, because both are independently and cheaply testable in isolation.
**Delivers:** Postgres schema (users, diary, `fdc_foods` with pgvector), offline FDC indexing pipeline (Foundation Foods + SR Legacy bulk download → embed → load), and the pure domain layer (BMR/TDEE/target calc, FDC matching function) with unit tests.
**Addresses:** FDC matching quality validation (embedding provider choice, raw/cooked spot-checks) and nutrition math correctness — the two things PROJECT.md's Core Value is explicit about.
**Avoids:** Pitfall 4 (raw/cooked mismatch) and Pitfall 5 (near-duplicate candidates) — both must be validated during indexing/matching build, before the correction UX locks in a "pick from 3" pattern that assumes the 3 are useful.

### Phase 2: Telegram bot skeleton + onboarding
**Rationale:** Onboarding needs no AI pipeline at all — it's a pure function of profile fields calling the already-built domain math from Phase 1 — making it the first demo-able, real-Telegram-interaction phase.
**Delivers:** Webhook handler with ack-first pattern, `/start`, onboarding conversation (sex, age, height, weight, activity, goal, rate, timezone), target KБЖУ calculation and display.
**Uses:** grammY + `@grammyjs/conversations`, ack-first webhook pattern (Pattern 1 from ARCHITECTURE.md).
**Implements:** Bot layer / application boundary — validates the hexagonal separation works end-to-end before the AI pipeline adds complexity.

### Phase 3: Voice pipeline — STT → LLM decomposition → FDC matching
**Rationale:** Depends on Phase 1 (matching, math) and Phase 2 (bot skeleton, webhook) both existing; this is where the product's core, riskiest value proposition gets wired end-to-end.
**Delivers:** STT adapter (Yandex SpeechKit primary, validated against real sample audio early in this phase per the STACK.md open question), LLM decomposition adapter (structured output + Zod schema), per-ingredient embedding + matching, "Секунду, разбираю" immediate feedback, in-process async orchestration with idempotency guard on `update_id`.
**Implements:** The `enqueue`/`process` seam discussed in the STACK/ARCHITECTURE reconciliation above — build it clean now so BullMQ is a later swap, not a rewrite.
**Avoids:** Pitfall 1 (unvalidated JSON), Pitfall 2 (hallucinated grams), Pitfall 11 (no idempotency), Pitfall 9 (voice file format/size assumptions).

### Phase 4: Confirm/correct flow + diary persistence
**Rationale:** Depends on everything in Phase 3 being wired; this is where the product becomes trustworthy per PROJECT.md's Core Value ("if recognition/calc aren't trustworthy, there's no product").
**Delivers:** Candidate-picker inline keyboards, ±10g grams adjuster, add/remove component, persisted `diary_draft` state (Postgres, not in-memory), final deterministic aggregation (pure math, no LLM), diary write, "нет данных" sugar handling.
**Addresses:** The already-scoped §5.6 correction flow, plus the table-stakes gap of editing/deleting an already-saved entry (reuses the same mechanics).
**Avoids:** Pitfall 7 (sugar coerced to 0), Pitfall 10 (in-memory draft state / callback_data limits).

### Phase 5: Diary views + table-stakes gap closure
**Rationale:** Once the core log→confirm→save loop is validated, the remaining table-stakes gaps (identified in FEATURES.md, not currently in Active scope) close the distance to category parity.
**Delivers:** Daily view (already partly scoped — extend to itemized list, not just totals), simple weekly/multi-day text-table summary, manual/text entry as an equal input mode (reuses Phase 3's decomposition pipeline directly).
**Addresses:** FEATURES.md's identified table-stakes gaps — weekly view, text-entry fallback.

### Phase Ordering Rationale

- Dependency-driven: domain math and FDC matching (Phase 1) have zero Telegram dependency and are the cheapest, highest-value things to validate first — this directly follows ARCHITECTURE.md's suggested build order.
- Onboarding (Phase 2) is inserted before the voice pipeline (Phase 3) because it validates the bot skeleton/webhook infrastructure with a much simpler, non-AI flow first — catching webhook/deploy issues (Pitfall 8) before the harder pipeline is layered on top.
- The correction/persistence phase (Phase 4) is deliberately separated from the raw pipeline-wiring phase (Phase 3) because it's where two of the most severe pitfalls (draft-state persistence, sugar-null handling) live, and research is explicit that these are schema/architecture decisions expensive to retrofit — better as their own reviewed phase than bundled in.
- Table-stakes feature gaps (Phase 5) are sequenced last because they're genuinely lower-risk, lower-cost additions that reuse mechanics built in earlier phases — not because they're unimportant, but because the core loop must be trustworthy before it's worth polishing breadth.
- Payment, reminders, and other explicitly-deferred features (per PROJECT.md) are not in this phase list at all — architecture research confirms this deferral is architecturally clean (both are additive against the same Postgres schema, on no critical path).

### Research Flags

Needs research during planning:
- **Phase 3 (voice pipeline):** STT provider choice is MEDIUM confidence (no controlled Kazakh/RU-mixed-speech benchmark exists) — needs a real-audio validation spike, not deeper desk research; flag as an implementation-time empirical task, not a `/gsd-research-phase` candidate.
- **Phase 1 (FDC matching):** Raw/cooked disambiguation strategy and candidate-diversity re-ranking (MMR/hybrid retrieval) are pattern-level recommendations without a VoxBite-specific benchmark — worth a focused research pass if initial spot-checks (per PITFALLS.md's recall@3 sanity check) show problems.

Phases with standard, well-documented patterns (skip deep research-phase):
- **Phase 2 (bot skeleton/onboarding):** grammY + webhook + conversations plugin is a standard, well-documented pattern (HIGH confidence across research).
- **Phase 4 (correction/persistence):** Hexagonal domain/adapter separation and Postgres-backed draft state are standard, well-documented patterns (HIGH confidence).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH for framework/DB/ORM choices (verified against npm registry + official docs); MEDIUM for STT provider and embedding model (no domain-specific benchmark exists, reasoned from documented coverage) |
| Features | MEDIUM (WebSearch-sourced, cross-verified across 3+ independent articles per claim; no official-docs coverage exists for this consumer-app domain) |
| Architecture | HIGH for component boundaries, webhook-ack pattern, hexagonal separation (standard, well-documented patterns); MEDIUM for exact Telegram webhook retry timing (not published in official docs, inferred from community reports) |
| Pitfalls | MEDIUM-HIGH (grounded in current provider docs/community sources for Telegram/LLM/webhook mechanics; nutrition-matching and non-dev-founder pitfalls are MEDIUM — pattern-level consensus, not VoxBite-specific case studies) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **STT provider selection (Yandex SpeechKit vs. OpenAI):** No controlled benchmark exists for the exact use case (short conversational Kazakhstani food-diary voice notes, RU/KZ mixed). Handle via a small manual validation spike early in Phase 3 (record ~10-20 real sample messages, run through both providers) before committing — this is TECH_SPEC's own open question #3, now with a concrete resolution plan.
- **Embedding model choice (`text-embedding-3-small` vs. `-large`):** Cheap to re-test given the tiny dataset (10-13k records, minutes to re-index) — treat as a safe-to-revisit decision during Phase 1, not a one-way door; A/B if Phase 1 spot-checks show confusable candidates.
- **Background job architecture (BullMQ vs. in-process async):** Explicitly reconciled above in favor of in-process async for v1 — flagged here as a decision to revisit explicitly once real users report lost/duplicate processing or a paid-subscriber phase begins.
- **Legal/medical disclaimer copy:** TECH_SPEC flags this as open (who writes final copy) — not a technical gap, but should be resolved before Phase 2 onboarding ships, since the disclaimer is an Active requirement.
- **Pregnancy/breastfeeding safety gate:** Identified as a real (if low-probability) gap in the current onboarding scope given the existing calorie-floor safety logic; recommended for v1.x, before any expansion past the closed friends-and-owner beta — not blocking initial launch given the tiny, known user base.

## Sources

### Primary (HIGH confidence)
- npm registry live queries (2026-08-10) — grammy, telegraf, ai, zod, pgvector, bullmq, drizzle-orm, prisma version/dist-tag data
- https://fdc.nal.usda.gov/download-datasets.html, https://fdc.nal.usda.gov/api-guide.html — official USDA FDC bulk download/API docs
- https://grammy.dev/resources/comparison, https://grammy.dev/guide/deployment-types.html — official grammY docs
- https://core.telegram.org/bots/webhooks — official docs (checked directly; does not publish exact retry timing, flagged honestly)
- OpenAI Structured Outputs and Vercel AI SDK official documentation
- pgvector GitHub repo + CHANGELOG + postgresql.org release notes
- Node.js release schedule (github.com/nodejs/Release)
- `TECH_SPEC.md` and `PROJECT.md` (this repo) — primary source for scope/gap analysis throughout

### Secondary (MEDIUM confidence)
- Yandex SpeechKit / Google Cloud STT docs + a single unresolved developer bug report on `kk-KZ` support
- Multiple 2026 pricing-aggregator and vector-DB-comparison articles (3+ sources converging per claim)
- Cal AI / MyFitnessPal / Cronometer / MacroFactor / Noom competitor reviews (3+ independent sources per claim)
- National Alliance for Eating Disorders, PubMed peer-reviewed source on tracking-app/disordered-eating association — HIGH confidence within this secondary set
- Community-reported Telegram webhook retry behavior (GitHub issue threads, not official docs)

### Tertiary (LOW confidence)
- Single-author critiques of Noom's coaching mechanics (corroborated by other sources, but individually lower-confidence)
- "Every Calorie Tracker App Feature Explained" marketing-adjacent guide — used only for corroboration of a widely-agreed pattern (weekly view), not as a standalone claim

---
*Research completed: 2026-08-10*
*Ready for roadmap: yes*
