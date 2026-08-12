---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: planning
stopped_at: Phase 3 context gathered
last_updated: "2026-08-12T07:58:46.196Z"
last_activity: 2026-08-12
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 15
  completed_plans: 15
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-10)

**Core value:** Точность распознавания блюда и подсчёта КБЖУ должна работать
надёжно, даже если оплата, лимиты и напоминания на старте отсутствуют.
**Current focus:** Phase 02 — bot-skeleton-onboarding

## Current Position

Phase: 3
Plan: Not started
Status: Ready to plan
Last activity: 2026-08-12

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 15
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 8 | - | - |
| 02 | 7 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P03 | 45min | 3 tasks | 12 files |
| Phase 01 P06 | 40min | 3 tasks | 7 files |
| Phase 01 P07 | 35min | 2 tasks | 1 files |
| Phase 01 P08 | 50min | 3 tasks | 13 files |
| Phase 02 P01 | 6min | 3 tasks | 5 files |
| Phase 02 P03 | same-day | 3 tasks | 3 files |
| Phase 02 P04 | 35min | 3 tasks | 7 files |
| Phase 02 P05 | 25min | 3 tasks | 5 files |
| Phase 02 P06 | 45min | 2 tasks | 5 files |
| Phase 02 P07 | same-day | 3 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Init: USDA FDC (Foundation Foods + SR Legacy only, no Branded Foods) via embedding + vector search (pgvector) as nutrient source.
- Init: Final КБЖУ calculation is deterministic math (grams × FDC per-100g), never LLM.
- Init: v1 excludes payment and reminders — only core log→confirm→save loop + onboarding + diary views.
- Roadmap: Standard/horizontal-layer mode chosen deliberately — domain math + FDC matching validated before any Telegram UI exists (Phase 1), accepting no visible bot demo until Phase 2.
- Roadmap: In-process async (no BullMQ/Redis) for v1 voice pipeline; must be built as a clean enqueue/process seam so a queue can be swapped in later without rewriting STT/LLM/matching logic.
- Roadmap: STT provider (Yandex SpeechKit vs. Whisper vs. Google) is MEDIUM confidence — needs a real-audio validation spike early in Phase 3, not deeper desk research.
- [Phase 01]: Migration workflow: drizzle-kit generate+migrate only (push banned); 3 separate migrations (pgvector extension, schema, RLS) for reviewability
- [Phase 01]: verify-schema.ts uses postgres.js in ${sql([...])} for IN-lists, not = any(sql.array()) which Postgres rejects there
- [Phase 01]: Embedding input text is the bare description string only (no category prepended) — deferred per 01-RESEARCH.md Open Question #2
- [Phase 01]: isIndexable() excludes only records with protein, fat AND carbs all null; a measured 0 counts as present data
- [Phase 01]: MATCH-02 brand-pollution check tightened to only fail on foundation_food matches or >200 total matches; SR Legacy legitimately contains ~26 brand-named entries by design
- [Phase 01]: D-02 amended — embedding model switched from text-embedding-3-small to text-embedding-3-large truncated to 1536 dims via OpenAI dimensions param, after verify-matches exposed a real white-rice/brown-rice retrieval failure; all 8,220 rows re-indexed for $0.0144
- [Phase 01]: fdc-repository findNearest must ORDER BY the raw cosineDistance expression ascending, never a computed similarity alias descending — the alias form silently defeats the HNSW index and falls back to a full Seq Scan (found via EXPLAIN, fixed in 35ac9f3)
- [Phase 02]: Did not install @grammyjs/menu — Phase 2's onboarding flow is strictly linear (InlineKeyboard + conversation.waitFor), per 02-RESEARCH.md Open Question 3
- [Phase 02]: BETA_ALLOWLIST kept out of REQUIRED_ENV_KEYS via a new OPTIONAL_ENV_KEYS export, so empty-on-first-run is explicit and fail-closed (D-04) instead of a crash
- [Phase 02]: Kept drizzle-kit auto-generated migration filename 0003_grey_anthem.sql instead of renaming to plan placeholder
- [Phase 02]: createAllowlistMiddleware returns MiddlewareFn<Context>, not the plan interface's broader Middleware<Context> union — the union includes MiddlewareObj which has no call signature
- [Phase 02]: pg-storage-adapter.test.ts mocks drizzle-orm's eq() to keep the StorageAdapter test hermetic (no real Postgres connection)
- [Phase 02]: InlineKeyboard.row() must only be called between buttons, never after the last one, or an empty trailing row is sent to Telegram
- [Phase 02]: onboardingConversation takes db as a plain third parameter, not read from ctx, closed over by Plan 06's createConversation registration
- [Phase 02]: изменить restart implemented as an outer while(true) loop -- installed @grammyjs/conversations v2 API has no reenter() method
- [Phase ?]: Widened Conversation<BotContext> alias to Conversation<BotContext, BotContext> so onboarding.ts type-checks against the real bot.ts registration
- [Phase ?]: 'Fully onboarded' for /start branching requires both onboardedAt and targetKcal non-null, not onboardedAt alone
- [Phase ?]: [Phase 02]: createPgStorageAdapter(db, keyPrefix) namespaces grammY session() and @grammyjs/conversations storage inside shared bot_sessions table -- two plugins defaulting to ctx.chatId as storage key collide silently

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: Embedding model choice (`text-embedding-3-small` vs. alternatives) is cheap to re-test given the small FDC dataset (~10-13k records) — treat as revisitable, not a one-way door.
- Phase 3: STT provider choice needs an empirical validation spike on real RU/KZ sample audio before locking in.
- Phase 4: Correction mechanic (3-candidate swap + ±10g + add/remove) is a proposed UX pattern from TECH_SPEC §5.6, not yet confirmed with the owner — confirm during `/gsd-discuss-phase` for Phase 4.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | Payments (PAY-01..03), Notifications (NOTIF-01..02), periodic weight re-entry + recalculation (GOAL-01), pregnancy/breastfeeding safety gate (GOAL-02), correction memory (MEM-01), barcode scan (SCAN-01), photo logging (PHOTO-01) | Deferred to v2 | Project init, 2026-08-10 |

## Session Continuity

Last session: 2026-08-12T07:58:46.184Z
Stopped at: Phase 3 context gathered
Resume file: .planning/phases/03-voice-pipeline/03-CONTEXT.md
