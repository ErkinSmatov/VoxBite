# VoxBite — контекст для Claude

## О проекте
VoxBite — платный Telegram-бот, который по голосовому сообщению пользователя
("что я съел") считает КБЖУ и сахар, используя реальные данные из USDA
FoodData Central (а не выдуманные LLM числа). Подробности — см.
[TECH_SPEC.md](./TECH_SPEC.md) и `.planning/` (GSD).

## Кто заказчик
Владелец проекта — Frontend/React-разработчик, **не имеет опыта с бэкендом,
инфраструктурой, БД, деплоем, платежами, очередями и т.п.** Из этого следует:

- Любая инструкция по настройке окружения, сервисов, деплою, переменным
  окружения, БД и т.д. должна быть расписана **пошагово и подробно**, как для
  человека, который видит это впервые: конкретные команды, куда их вставлять,
  что должно получиться в результате, как проверить, что шаг сработал.
- Не используй бэкенд-жаргон без объяснения (например, если упоминаешь
  "миграцию", "воркер", "очередь", "vector DB" — коротко поясни, что это и
  зачем оно здесь).
- Перед необратимыми/дорогими действиями (деплой в прод, трата платных API,
  создание платёжных интеграций, работа с реальными деньгами) — объясняй
  последствия заранее, а не постфактум.

## Правило: не соглашаться автоматически

**Не поддакивай.** Если предложение, формулировка задачи или технический выбор
заказчика может навредить проекту (заложить архитектурную проблему, создать
риск безопасности/утечки платёжных или медицинских данных, привести к
неконтролируемым расходам на LLM/API, ухудшить UX, или просто не будет
работать так, как заказчик думает) — прямо скажи об этом **до** реализации,
объясни риск в 1-2 предложениях и предложи альтернативу. Не меняй своё мнение
только потому, что пользователь настаивает — если у него нет нового
контраргумента по существу, повтори позицию и укажи, что готов реализовать
как просят, если он подтвердит осознанно.

Это не значит быть противником по умолчанию — если предложение разумное,
подтверди это и двигайся дальше без искусственных возражений.

## Технические ограничения проекта (принятые решения)
- Итоговые КБЖУ/сахар считаются математически (граммы × нутриенты из FDC),
  **не** LLM — LLM используется только для распознавания речи и декомпозиции
  блюда на ингредиенты с оценкой граммовки, не для арифметики нутриентов.
- Каждый компонент блюда сопоставляется с 3 кандидатами из USDA FDC через
  embedding-based vector search, а не через точное совпадение строк.
- Пользователь обязательно подтверждает/корректирует распознанные ингредиенты
  перед тем, как результат считается финальным и сохраняется в дневник.
- Лимит голосовых сообщений в месяц завязан на тариф подписки (см. TECH_SPEC.md).

<!-- GSD:project-start source:PROJECT.md -->
## Project

**VoxBite**

Telegram-бот, который по голосовому сообщению пользователя ("что я съел")
распознаёт блюдо, раскладывает его на ингредиенты с граммовкой, находит для
каждого ингредиента реальную запись в базе USDA FoodData Central через
embedding-поиск и математически считает КБЖУ и сахар (по возможности —
не все записи FDC содержат сахар). Пользователь подтверждает или
корректирует распознанное перед сохранением в дневник. На онбординге бот
считает пользователю целевые КБЖУ под цель (набор/сброс веса не быстрее
1 кг/месяц, либо поддержание/биохакинг). В будущем — платная подписка
(месяц/год через локальный эквайер, например Kaspi Pay) с лимитом голосовых
сообщений и мотивационными напоминаниями, но это отдельные фазы после
проверки core-цикла.

**Core Value:** Точность распознавания блюда и подсчёта КБЖУ — это должно работать
надёжно, даже если оплата, лимиты и напоминания на старте отсутствуют.
Если распознавание/подсчёт не заслуживают доверия — продукта нет.

### Constraints

- **Оплата**: локальный эквайер/платёжный агрегатор (например, Kaspi Pay),
  не встроенный Telegram Payments API — последний не принимает тенге без
  локального эквайера. Реализуется отдельной фазой после core-цикла.
- **Данные о нутриентах**: только официальные значения из USDA FDC,
  математически посчитанные по граммовке — LLM не участвует в арифметике
  нутриентов, только в распознавании речи и декомпозиции блюда.
- **Темп изменения веса**: цель по набору/снижению веса не может задавать
  темп быстрее 1 кг/месяц — жёстко ограничено в формуле расчёта целевых
  калорий (TECH_SPEC.md §6.3).
- **Приватность**: голосовые сообщения — чувствительные данные (голос +
  здоровье/питание); исходные аудиофайлы не хранятся дольше, чем нужно для
  транскрипции.
- **Разработчик-заказчик без бэкенд-опыта**: любые шаги настройки
  (БД, ключи API, деплой) должны сопровождаться подробными пошаговыми
  инструкциями.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS (or 24 LTS) | Runtime | Node 24 ("Krypton") is Active LTS as of Oct 2025 (EOL 2028-04); Node 22 ("Jod") is in Maintenance LTS (EOL 2027-04). Either is safe; prefer 22 for maximum tooling/library compatibility right now, 24 if starting fresh with no legacy constraints. Do not use a non-LTS "Current" release (26) for a project one person will maintain solo — LTS means fewer breaking surprises. |
| TypeScript | 5.9.x | Language | Matches owner's existing skillset (React/TS dev) — this is the single highest-leverage stack decision for a backend-inexperienced owner: it means every layer (bot handlers, LLM schema validation, DB queries) uses one language and one type system they already know. |
| grammY | 1.45.1 | Telegram Bot framework | See dedicated comparison below — recommended over Telegraf. |
| PostgreSQL | 17.x | Primary datastore (users, diary, subscriptions, FDC index) | One database for both relational data and vector search (via pgvector) — no second service to run, patch, or pay for. Use a managed provider (Supabase, Neon, Railway, Render Postgres) so the owner never touches `pg_hba.conf` or extension installation by hand — all of them ship pgvector pre-enabled or enable it with one `CREATE EXTENSION`. |
| pgvector | 0.8.x (extension) | Vector similarity search inside Postgres | Sufficient — see dedicated section below. Do not reach for Qdrant/Pinecone at this record count (~10-13k). |
| Drizzle ORM | 0.45.x (`drizzle-orm`) | Database access / migrations | TypeScript-first, thin layer over SQL, first-class `pgvector` column type support via `drizzle-orm/pg-core`. Recommended over Prisma for this project specifically because: (a) Drizzle's query builder stays close to SQL, which is valuable when the owner needs to understand/debug vector `ORDER BY embedding <=> $1` queries — an ORM that hides SQL too well makes debugging cosine-distance queries harder to learn; (b) Prisma 7 (current major, Nov 2025) dropped its Rust query engine for a pure-TS engine, which is a large architecture change mid-migration for a new project — safer to start on the simpler, more stable tool. Prisma is a fine alternative if the owner finds Drizzle's raw-SQL style uncomfortable (see Alternatives). |
| BullMQ | 6.x | Background job queue for voice processing pipeline — **deferred past v1, see note below** | De facto standard Node.js job queue, Redis-backed. STACK.md's initial research recommended adopting it from Phase 1; this was reconciled against ARCHITECTURE.md in `.planning/research/SUMMARY.md` in favor of **in-process async for v1** (no Redis dependency) — this is a closed beta for the owner + a few friends, not a queue-engineering exercise, and Redis is a second infra dependency to operate for a durability guarantee that isn't load-bearing yet. The Phase 3 voice pipeline (per `.planning/ROADMAP.md`) must still be built as a clean `enqueue`/`process` seam with idempotency (Telegram `update_id`) and persisted (not in-memory) draft state, so adding BullMQ later is a swap, not a rewrite. Revisit once real users report lost/duplicate processing, or the payment phase begins. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ai` (Vercel AI SDK) | 7.0.x | Structured-output LLM calls (dish decomposition JSON) | Use `generateObject()` with a Zod schema for the "text → `{items: [{component, component_en, grams}]}`" call. Provider-agnostic (works with OpenAI, Google, Anthropic under one API) — lets you swap the decomposition model later without rewriting parsing/validation logic. The Zod schema is simultaneously the runtime validator and the TypeScript type — a pattern that will feel immediately familiar to a React dev used to Zod-validated forms. |
| `zod` | 4.4.x | Schema validation | Backbone of the AI SDK structured-output schema, and also useful for validating onboarding form inputs (age/height/weight) and webhook payloads (payment provider callbacks). |
| `openai` | latest 5.x | Direct OpenAI SDK access (embeddings, STT) | Use directly (not through the AI SDK abstraction) for embeddings and STT calls — `generateObject` abstraction only pays off for the structured chat completion, not for embeddings/audio endpoints. |
| `@grammyjs/conversations` | latest | Multi-step onboarding flow (grammY plugin) | Onboarding collects 6+ sequential fields (sex, age, height, weight, activity, goal) — this official grammY plugin gives you a linear `async function` conversation flow instead of hand-rolled session-state machines. |
| `@grammyjs/hydrate` / `@grammyjs/menu` | latest | Inline keyboards for ingredient-candidate selection (the `▾` picker in TECH_SPEC §5.6) | `@grammyjs/menu` gives declarative, stateful inline menus — a good fit for "pick 1 of 3 FDC candidates" and the +/-10g adjusters, avoids manual `callback_data` string-parsing. |
| `csv-parse` | latest | Streaming CSV parser for USDA FDC bulk indexing script | Use in streaming mode even though the dataset is small (10-13k rows) — habit that scales if Branded Foods is ever added later, and avoids loading the raw multi-hundred-MB `food_nutrient.csv` (Foundation+SR Legacy combined has this several nutrients-per-food rows) fully into memory. |
| `pgvector` (npm) | latest | Node.js helper for `vector` type (de/serializing `number[]` ↔ Postgres `vector`) | Small helper package (from the pgvector project itself) for formatting embedding arrays for Drizzle/raw SQL inserts and queries — avoids hand-rolling `'[0.1,0.2,...]'` string formatting. |
| `node-cron` or BullMQ repeatable jobs | latest | Scheduler for reminders/notifications (Phase, later) | BullMQ already supports repeatable/cron-like jobs natively — no need for a second scheduling library once BullMQ is in the stack. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Docker Compose | Local Postgres for development | One `docker-compose.yml` with `pgvector/pgvector:pg17` image (official pgvector-preinstalled Postgres image). Removes "how do I install Postgres extensions" as a setup step for the owner. Redis is **not** needed for v1 (queue is deferred — see BullMQ note above); add a `redis:7` service only when BullMQ is actually adopted. |
| `dotenv` / `dotenv-safe` | Environment variable loading | Required per TECH_SPEC §10 — secrets never in code. `dotenv-safe` additionally fails fast if a required env var is missing, which surfaces misconfiguration immediately instead of as a runtime 500 later — valuable for a solo, backend-inexperienced owner debugging alone. |
| Vitest | Unit tests (esp. the math §5.7 calorie/macro calculation and §6 TDEE formula) | The calorie/macro math and BMR/TDEE formulas are exactly the kind of pure-function logic that deserves tests — they're the "must not be wrong" core value of the product per PROJECT.md. Vitest is fast and has near-identical API to Jest, well documented, TS-native. |
## Installation
# Core
# grammY plugins
# CSV parsing for one-time FDC indexing script
# Dev dependencies
## Domain-Specific Comparisons
### 1. Telegram bot framework: grammY vs Telegraf
| Criterion | grammY | Telegraf |
|---|---|---|
| Weekly npm downloads | ~1.26M | ~857K |
| TypeScript support | Written in TypeScript, types are first-class and exhaustive | Also has TS types, but historically bolted on rather than designed-in |
| Plugin ecosystem | Official plugins for sessions, conversations (multi-step flows), menus, rate-limiting, i18n — actively maintained under the `grammyjs` org | Has plugins too, but ecosystem is comparatively smaller/less actively updated |
| Docs quality | Extensive, example-driven, includes a dedicated "how grammY compares to other frameworks" doc | Solid but less extensive |
| Maturity/community size | Newer but has overtaken Telegraf in downloads; large Discord community | Older, longer track record, still widely used |
### 2. Speech-to-Text: Whisper API vs Yandex SpeechKit vs Google STT
| Provider | Model | Russian | Kazakh | Mixed RU/KZ code-switching | Cost | Notes |
|---|---|---|---|---|---|---|
| **Yandex SpeechKit** | STT v3 | Strong — Yandex's primary market/training focus is RU | **Native support** — one of very few commercial APIs with dedicated Kazakh + explicit "Kazakh-Russian mixed speech" recognition | Explicitly supported | Pay-per-second, competitive for CIS-region usage | Requires a Yandex Cloud account; billing infrastructure is oriented at RU/CIS, works fine from Kazakhstan |
| **OpenAI Whisper API / `gpt-4o-transcribe`** | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` | Strong — Russian is a well-represented language in Whisper's training data | Nominally supported (one of ~99 languages) but Kazakh is low-resource in Whisper's training set — published research shows ~14.5% WER for a **fine-tuned** Whisper model on Kazakh (base/off-the-shelf models likely worse); this is a meaningfully higher error rate than for Russian | Not a documented capability — Whisper does per-utterance language detection, not designed for intra-sentence code-switching | `whisper-1`/`gpt-4o-transcribe`: $0.006/min; `gpt-4o-mini-transcribe`: $0.003/min | Same vendor as a plausible LLM choice for dish decomposition — one fewer provider account to manage |
| **Google Cloud Speech-to-Text (Chirp 2/3)** | Chirp | Strong | Listed as a supported locale (`kk-KZ`) in docs, but real-world developer reports (Feb 2024 forum thread, unresolved as of this research) describe it as **not actually working** for some recognition methods | Not documented | Per-15-second billing | Riskiest choice given the specific, documented Kazakh-support complaint — do not select without your own validation test first |
### 3. Embedding model: gemini-embedding-001 vs OpenAI text-embedding-3-small/large
| Model | Price (per 1M input tokens) | Dimensions | MTEB (English/avg) | Notes |
|---|---|---|---|---|
| `text-embedding-3-small` (OpenAI) | $0.02 | 1536 (Matryoshka-truncatable to 256/512/1024) | ~62.3 avg | Cheapest, more than sufficient quality for short, unambiguous English food-item phrases |
| `text-embedding-3-large` (OpenAI) | $0.13 | 3072 (Matryoshka-truncatable) | ~64.6 avg | ~6.5x the cost of `small`; marginal quality gain in absolute MTEB terms |
| `gemini-embedding-001` (Google) | $0.15 | 3072 default (Matryoshka-truncatable to 768/1536) | 68.32 on MTEB **Multilingual** leaderboard | Its strength (68.32) is specifically a *multilingual* benchmark score — not directly comparable to the English-only scores above, and not the capability this project needs given translation happens pre-embedding. ~7.5x the cost of `text-embedding-3-small`. |
### 4. Vector search: pgvector vs dedicated vector DB (Qdrant/Pinecone)
- Dataset size: Foundation Foods + SR Legacy ≈ 10-13k records — three to four orders of magnitude below where dedicated vector databases start to differentiate themselves on performance.
- Current pgvector (0.8.x) supports HNSW indexing, and multiple 2026 benchmark write-ups report pgvector-with-HNSW matching or beating dedicated vector DBs on comparable hardware even at **1M**-vector scale — the crossover point where a dedicated vector DB clearly wins is materially larger than this project's needs (multi-million-vector or high-QPS multi-tenant workloads).
- Operational cost: pgvector adds zero new services — it is an extension inside the Postgres instance the project already needs for users/diary/subscriptions. A dedicated vector DB (Qdrant self-hosted, or Pinecone managed) is a second service to provision, authenticate to, monitor, and pay for — a real tax on a backend-inexperienced solo owner, for no accuracy/performance benefit at this scale.
- TECH_SPEC's own explicit fallback trigger ("if Branded Foods [~2M records] is added later, reconsider Qdrant/Pinecone") is the right threshold — do not pre-optimize for that before it's a real requirement.
### 5. Structured output for dish decomposition
- OpenAI's Structured Outputs (`strict: true` with a `json_schema`) constrains token sampling itself so the model is architecturally unable to emit a token that violates the schema — this is qualitatively different from prompt-only JSON requests, which can still produce malformed or off-schema output that needs defensive parsing/retry logic (TECH_SPEC §5.3 already correctly identifies this need).
- Using the Vercel AI SDK (`ai` package, `generateObject`) instead of calling the OpenAI SDK's structured-output feature directly buys provider portability: define the dish-decomposition schema once in Zod, and the same code works whether the underlying model is an OpenAI, Google, or Anthropic model — useful if the owner wants to compare decomposition quality/cost across providers later without rewriting the parsing layer.
- Zod schema also directly satisfies TECH_SPEC §5.3's requirement ("JSON should pass strict schema validation... via structured output / function calling mode") — the schema *is* the validator.
- Always check for a refusal/empty-result case (model declines or returns nothing parseable) and retry with a stricter/clarified prompt before giving up and telling the user "couldn't parse, try rephrasing" — this matches TECH_SPEC §5.3's specified fallback behavior.
### 6. USDA FoodData Central: acquisition method
- FDC publishes downloadable datasets at `fdc.nal.usda.gov/download-datasets` in both CSV and JSON, updated on a schedule: **Foundation Foods** and Branded Foods are refreshed twice yearly (April/December — latest as of this research is April 2026); **SR Legacy** is a frozen, final dataset (last released April 2018, no longer updated, but still authoritative for raw/whole foods per USDA's own framing).
- Download the **Foundation Foods** and **SR Legacy** archives specifically (not the "Full Download of All Data Types" bundle) — the full bundle includes Branded Foods (~2M rows), which TECH_SPEC explicitly scopes out of v1 and would slow down/bloat a targeted 10-13k-record indexing script for no benefit.
- The live API (`api.nal.usda.gov/fdc/v1`) is rate-limited to 1,000 requests/hour per API key by default — workable for occasional lookups or spot-checks, but impractical for indexing thousands of records or for periodic re-indexing when a new Foundation Foods release drops. USDA's own guidance is explicit: switch to bulk download once you're pulling more than a few thousand records.
- Since April 2023, each bulk archive bundles its own supporting reference tables (nutrient definitions, units, etc.) in the same download — no separate "supporting data" download step needed.
- Practical indexing script shape: stream-parse `food.csv` (or `.json`) + `food_nutrient.csv` (+ `nutrient.csv` for nutrient ID→name mapping) with `csv-parse`, join on `fdc_id`, build one row per food (id, name/description, calories/protein/fat/carbs/sugar-per-100g — sugar `null` when absent per TECH_SPEC §5.8, not zero), batch-embed the descriptions (batch of ~100 per OpenAI embeddings call), and bulk-insert into the Postgres table with its `vector` column.
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| grammY | Telegraf | If the owner finds a specific tutorial/course built on Telegraf and prefers to follow it literally; both are production-grade. |
| Yandex SpeechKit | OpenAI `gpt-4o-transcribe`/`whisper-1` | If Phase 1 real-audio testing shows the actual user base speaks Russian-only in practice (no meaningful Kazakh/mixed usage) — trades slightly better hypothetical Kazakh accuracy for one fewer vendor account and unified billing with the LLM provider. |
| `text-embedding-3-small` | `text-embedding-3-large` | If Phase-1 retrieval-quality testing shows confusable top-3 candidates (e.g., wrong cut/preparation of the same base ingredient ranking too closely) — cheap to re-index and A/B given the tiny dataset. |
| pgvector | Qdrant (self-hosted) or Pinecone (managed) | Only if/when Branded Foods (~2M records) is added post-v1, or if query latency/QPS requirements grow far beyond a closed-beta user base — not a v1 concern. |
| Drizzle ORM | Prisma 7 | If the owner strongly prefers a schema-first, more "batteries-included" ORM experience and is comfortable with an ORM that abstracts more SQL away — Prisma 7's pure-TS engine (no more Rust binary) removed one historical pain point (cold starts, native-binary deployment issues) and it does have `vector` type support now, so it's a legitimate choice, just not the default recommendation here. |
No queue, in-process async processing (built as a swappable `enqueue`/`process` seam) | BullMQ from Phase 1 | **This is the reconciled v1 decision** (see `.planning/research/SUMMARY.md`), not just an alternative — reserve BullMQ for once real users report lost/duplicate processing or the payment phase begins. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `node-telegram-bot-api` | Callback-style API predates modern async/await idioms, thin ecosystem, not TypeScript-native, effectively unmaintained pace of releases (still 1.2.0) | grammY |
| Prompt-only "return JSON" without schema constraints | No structural guarantee, requires defensive regex/try-catch parsing and manual retry logic that provider-native structured output eliminates | OpenAI/Gemini structured outputs via `generateObject` + Zod |
| Google Cloud STT (Chirp) as the sole/default provider for Kazakh audio | Documented, unresolved developer report of `kk-KZ` not actually working in some recognition paths | Yandex SpeechKit (Kazakh-native) as primary, OpenAI STT as Russian-only fallback |
| Dedicated vector DB (Qdrant/Pinecone) at launch | Solves a scale problem (multi-million-vector, high-QPS) this project does not have at 10-13k records; adds a second infra dependency to operate | pgvector inside the existing Postgres instance |
| Live FDC API for bulk indexing | 1,000 req/hour rate limit makes it impractical for a 10-13k-record one-time index, and the wrong tool for an offline batch job | FDC bulk CSV/JSON download |
| "Full Download of All Data Types" FDC bundle | Includes Branded Foods (~2M rows) explicitly out of scope for v1 (PROJECT.md), bloats and slows the indexing pipeline for no v1 benefit | Targeted Foundation Foods + SR Legacy downloads |
## Stack Patterns by Variant
- Consider running the *same* audio through two providers (Yandex + OpenAI) and picking the higher-confidence/longer transcript, or asking the user to confirm the transcribed text before decomposition — adds cost and latency, only justified if STT proves to be where most user corrections happen.
- `gpt-4o-mini-transcribe` ($0.003/min) instead of `gpt-4o-transcribe`/`whisper-1` ($0.006/min) if Kazakh/mixed accuracy is not the deciding factor for the STT provider choice.
- Batch embedding calls (already recommended) and cache embeddings for repeated ingredient names the LLM already decomposed before (e.g., "chicken breast" recurs across many users/messages) to avoid re-embedding identical strings.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `pgvector` (Postgres extension) 0.8.x | PostgreSQL 15+ (HNSW/quantization features assume 0.8-line); confirmed working with Postgres 17 and 18 | Use the official `pgvector/pgvector:pg17` Docker image locally to avoid manual extension compilation. |
| `drizzle-orm` 0.45.x | `pg` 8.x driver, TypeScript 5.x | Drizzle's `pgvector` column helpers require the `vector` extension to already be enabled on the database (`CREATE EXTENSION IF NOT EXISTS vector;` migration). |
| `ai` (Vercel AI SDK) 7.0.x | `@ai-sdk/openai` 4.0.x, `@ai-sdk/google` 4.0.x provider packages, `zod` 4.x | The AI SDK's own major version numbering and its provider-package major version numbers do not track each other 1:1 (e.g., core `ai` package is on major 7, `@ai-sdk/openai` "latest" resolves to 4.0.x) — always resolve via `npm view <pkg> version`/dist-tags rather than assuming version parity between the core package and provider packages. |
| `zod` 4.4.x | `ai` 7.0.x `generateObject` | Confirm the AI SDK version in use supports Zod v4 schemas at implementation time — Zod 3→4 was a notable breaking change across the ecosystem; some integration guides in the wild still show Zod 3 syntax. |
| `bullmq` 6.x | Redis 7.x (via `ioredis`) | No exotic Redis config needed — any managed Redis (Upstash, Railway) with default settings works. |
## Sources
- npm registry (live `npm view` queries, 2026-08-10) — grammy, telegraf, ai, zod, pgvector, @ai-sdk/openai, @ai-sdk/google, bullmq, drizzle-orm, pg, prisma, node-telegram-bot-api version/dist-tag data. HIGH confidence (primary source).
- https://grammy.dev/resources/comparison — grammY's own framework comparison. HIGH confidence for grammY-side claims, cross-checked against download counts.
- https://github.com/grammyjs/grammy, https://telegraf.js.org/v3 — official docs.
- https://cloud.yandex.com/en-ru/docs/speechkit/stt/, https://aistudio.yandex.ru/docs/en/speechkit/stt/models.html — Yandex SpeechKit language support. MEDIUM-HIGH confidence.
- OpenAI transcription pricing/model pages (aggregated via WebSearch, cross-referenced across multiple 2026 pricing-tracker sites reporting consistent numbers: $0.006/min whisper-1 & gpt-4o-transcribe, $0.003/min gpt-4o-mini-transcribe). MEDIUM confidence (not fetched directly from openai.com pricing page in this pass — recommend a final price check against platform.openai.com/pricing before implementation).
- Google Cloud Speech-to-Text Chirp docs (docs.cloud.google.com/speech-to-text) + a developer-forum bug report on `kk-KZ` support (discuss.google.dev, Feb 2024 thread, unresolved). MEDIUM confidence — single bug report, not independently reproduced by this research.
- https://openai.com/index/new-embedding-models-and-api-updates/ and multiple 2026 pricing-aggregator sites (embeddingcost.com, tokenmix.ai, pecollective.com) cross-referenced for `text-embedding-3-small/large` and `gemini-embedding-001` pricing/dimensions/MTEB. MEDIUM-HIGH confidence (pricing/dims independently corroborated across 3+ sources; MTEB numbers attributed to OpenAI's own reported figures and the public MTEB leaderboard).
- pgvector GitHub repo (github.com/pgvector/pgvector) + CHANGELOG + postgresql.org release announcements for 0.7.0/0.8.x. HIGH confidence.
- Multiple 2026 vector-database comparison articles (firecrawl.dev, kalviumlabs.ai, layerbase.com) independently converging on "pgvector sufficient under ~1M vectors, matches/beats dedicated DBs at that scale with HNSW." MEDIUM-HIGH confidence — no single canonical benchmark source, but strong multi-source agreement.
- https://fdc.nal.usda.gov/download-datasets.html and https://fdc.nal.usda.gov/api-guide.html — official USDA FDC bulk download and API documentation, fetched directly. HIGH confidence (primary source).
- OpenAI Structured Outputs announcement (openai.com/index/introducing-structured-outputs-in-the-api) + community docs on strict `json_schema` mode. HIGH confidence.
- Vercel AI SDK official docs (ai-sdk.dev/docs/ai-sdk-core/generating-structured-data). HIGH confidence.
- BullMQ official site (bullmq.io) + 2026 community write-ups. HIGH confidence for BullMQ being the standard choice; version number verified directly via npm.
- Node.js release schedule (github.com/nodejs/Release, nodejs.org release blog). HIGH confidence.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
