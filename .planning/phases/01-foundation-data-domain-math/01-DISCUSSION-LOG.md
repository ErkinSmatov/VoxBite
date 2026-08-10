# Phase 1: Foundation — data + domain math - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-10
**Phase:** 1-Foundation — data + domain math
**Areas discussed:** Postgres hosting, API keys/embedding provider, FDC indexing script invocation, KБЖУ macro preset ratios

---

## Postgres hosting

| Option | Description | Selected |
|--------|-------------|----------|
| Облачный хостинг (Supabase) | Free tier, pgvector built in, no local Docker setup, data visible in a web UI | ✓ |
| Локально через Docker | Full control, but owner must install Docker and manage the database themselves | |
| Ты не знаешь, пусть Claude решит | Standard choice for owner's skill level — Supabase, with detailed setup instructions | |

**User's choice:** Облачный хостинг (Supabase)
**Notes:** Owner has no backend infra experience and explicitly wants to avoid local database setup.

---

## API keys / embedding provider

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI | `text-embedding-3-small` — cheap, accurate enough for short English ingredient names | |
| Google (Gemini) | `gemini-embedding-001` — more expensive, multilingual strength not needed here | |
| Ни одного нет, надо завести | Owner has no existing API accounts for any provider | ✓ |

**User's choice:** Ни одного нет, надо завести
**Notes:** Resolved to OpenAI as the embedding provider for this phase (per research/STACK.md recommendation) since it's cheapest/simplest and the account will likely be reused in Phase 3 for LLM decomposition.

---

## FDC indexing script invocation

| Option | Description | Selected |
|--------|-------------|----------|
| Простая команда в терминале | e.g. `npm run index-fdc` — owner runs manually once | ✓ |
| Не важно, пусть Claude решит | Standard approach — manual terminal invocation | |

**User's choice:** Простая команда в терминале
**Notes:** Owner will run this once (and again only if the FDC dataset is refreshed). Plan must document exact command, expected output, and recovery steps if it fails partway.

---

## KБЖУ macro preset ratios

| Option | Description | Selected |
|--------|-------------|----------|
| Дай Claude выбрать разумные дефолты | Middle of TECH_SPEC's stated ranges (protein 1.8 g/kg, fat 0.9 g/kg), documented in code as adjustable constants | ✓ |
| Хочу сам указать точные цифры | Owner specifies exact values | |

**User's choice:** Дай Claude выбрать разумные дефолты
**Notes:** Not a locked nutritional claim — documented as changeable constants, not hardcoded magic numbers.

---

## Claude's Discretion

- Exact Postgres schema field names/types, migration tool internals (Drizzle per research/STACK.md), internal module structure of the domain layer.
- Exact BMR/TDEE/macro-preset constants beyond the protein/fat ratios above (e.g. exact calorie safety floor values — TECH_SPEC.md §6.3 already gives ~1200/1500 kcal reference floors).

## Deferred Ideas

None — discussion stayed within Phase 1 scope.
