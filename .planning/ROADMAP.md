# Roadmap: VoxBite

## Overview

VoxBite ships as a closed-beta Telegram bot that turns a voice (or text)
description of a meal into a trustworthy, ingredient-level diary entry. The
roadmap follows the research-recommended horizontal-layer structure: the two
hardest-to-verify, most product-critical pieces — nutrition math and FDC
embedding matching — are built and validated first, with zero Telegram
dependency, before any bot UI exists. Onboarding then validates the bot
skeleton/webhook plumbing with a simple, non-AI flow. The voice pipeline
(STT → LLM decomposition → FDC matching) wires the riskiest AI chain end to
end. Confirm/correct + diary persistence is where the product becomes
trustworthy per Core Value — draft state, deterministic math, and
missing-nutrient handling all live here. Diary views close the remaining
table-stakes gaps (daily/weekly view) using mechanics already built. Payment,
reminders, and other v2 features are explicitly out of this roadmap.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation — data + domain math** - Postgres schema, offline USDA FDC indexing pipeline, and pure domain layer (BMR/TDEE/target calc, FDC embedding matching) — no Telegram, no bot code (completed 2026-08-11)
- [ ] **Phase 2: Bot skeleton + onboarding** - Webhook handler and onboarding conversation that collects profile data and shows calculated КБЖУ targets
- [ ] **Phase 3: Voice pipeline** - Voice/text message → STT → LLM dish decomposition → per-ingredient FDC matching, wired end to end with idempotency
- [ ] **Phase 4: Confirm/correct + diary persistence** - Candidate-picker correction UX, persisted draft state, deterministic final calculation, diary write, edit/delete saved entries
- [ ] **Phase 5: Diary views** - Daily diary view and weekly summary against targets

## Phase Details

### Phase 1: Foundation — data + domain math
**Goal**: Postgres schema, offline USDA FDC indexing pipeline, and a pure, fully unit-testable domain layer (nutrition target math + FDC embedding matching) exist and are validated — independent of any Telegram code.
**Depends on**: Nothing (first phase)
**Requirements**: ONBOARD-03, ONBOARD-04, MATCH-01, MATCH-02
**Success Criteria** (what must be TRUE):
  1. Postgres schema (users, diary, `fdc_foods` with a pgvector column) exists and migrations run cleanly against a fresh database.
  2. The offline FDC indexing pipeline populates `fdc_foods` from Foundation Foods + SR Legacy only (no Branded Foods), with a per-record embedding and per-100g nutrients including calories/protein/fat/carbs/sugar (nullable where FDC has no sugar value).
  3. Unit tests pass for the target-calorie/macro calculation (Mifflin-St Jeor BMR + activity-level TDEE + ≤1 kg/month rate cap + safety calorie floor + BЖУ preset split) across representative sample cases covering each sex and each goal (gain/loss/maintain).
  4. A manual or scripted query against the matching function returns 3 plausible FDC candidates for at least 10 hand-picked English ingredient names, with no candidate coming from Branded Foods.
**Plans**: 8 plans

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Node/TypeScript scaffolding, Vitest, secret hygiene, env loader, check-setup script

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02-PLAN.md — Owner sets up Supabase (pgvector) + OpenAI (key, hard spend cap) and a working .env
- [x] 01-04-PLAN.md — Nutrition domain math: Mifflin-St Jeor, TDEE, rate cap, safety floor, target macros (TDD)
- [x] 01-05-PLAN.md — FDC download/unzip, food.csv parsers with the foundation_food filter, priority-ordered nutrient resolution

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-03-PLAN.md — Drizzle schema (users, diary, fdc_foods + vector(1536)/HNSW), versioned migrations applied, RLS, verify-schema

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-06-PLAN.md — OpenAI embedding adapter, idempotent fdc_foods loader, npm run index-fdc pipeline

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-07-PLAN.md — Run the indexing pipeline for real and verify the loaded index (verify-index)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 01-08-PLAN.md — matchIngredient port + Drizzle/pgvector repository + verify-matches over 10 ingredient names

### Phase 2: Bot skeleton + onboarding
**Goal**: Users can complete onboarding through the real Telegram bot and see their calculated КБЖУ targets, validating the webhook/bot-framework plumbing before the AI pipeline is layered on top.
**Depends on**: Phase 1 (uses domain math for target calculation)
**Requirements**: ONBOARD-01, ONBOARD-02, ONBOARD-05, ONBOARD-06
**Success Criteria** (what must be TRUE):
  1. User can run `/start` and complete onboarding by answering each field (sex, age, height, weight, activity level, goal, timezone) via a mix of inline buttons and text input.
  2. If the user selects a weight-gain/loss goal, the desired rate they can enter is capped at 1 kg/month by the input UI itself, not only by the underlying formula.
  3. After onboarding, the user sees their calculated target calories and macros and can either confirm them or restart onboarding to change inputs.
  4. The user sees a non-medical-device disclaimer during onboarding, before targets are confirmed.
**Plans**: 7 plans

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — grammY + conversations deps, npm run bot, env.ts TELEGRAM_BOT_TOKEN/BETA_ALLOWLIST, BotFather walkthrough
- [x] 02-02-PLAN.md — pure onboarding logic: field parsing, option lists, rate presets, profile assembly, Russian copy + disclaimer
- [x] 02-03-PLAN.md — bot_sessions schema, generated migration + RLS, blocking owner review before db:migrate

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-04-PLAN.md — Postgres session storage adapter, fail-closed allowlist gate, /whoami, entrypoint with 409 handling

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-05-PLAN.md — inline keyboards, idempotent users upsert, the seven-step onboarding conversation

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 02-06-PLAN.md — /start with the already-onboarded branch, conversation registration, manual checklist document

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 02-07-PLAN.md — owner sign-off on the disclaimer wording and the manual checklist walkthrough
**UI hint**: yes

### Phase 3: Voice pipeline
**Goal**: A voice or text message describing a meal is transcribed, decomposed into components with gram estimates, and each component is matched against FDC candidates — wired end to end with immediate ack and idempotent processing.
**Depends on**: Phase 1 (matching function, domain layer) and Phase 2 (bot skeleton, webhook)
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, DECOMP-01, DECOMP-02, DECOMP-03
**Success Criteria** (what must be TRUE):
  1. User can send a voice message describing a meal and immediately receives an acknowledgment (e.g. "Секунду, разбираю") while processing continues in the background.
  2. The voice message is transcribed via STT (RU/KZ) into text with reasonable accuracy on a manual spot-check of ~10 real sample recordings.
  3. The transcribed (or typed) text is decomposed by the LLM into components with English names and gram estimates; a single-ingredient dish (e.g. "banana") yields exactly one component, not an artificially split list.
  4. LLM output is schema-validated (structured output + Zod); an invalid or empty result triggers one retry, and a second failure produces a user-facing "couldn't parse, describe differently" message instead of silently failing.
  5. User can send typed text instead of a voice message and it flows through the identical STT-output → decomposition → matching pipeline, with duplicate/retried Telegram updates not producing duplicate processing.
**Plans**: TBD

### Phase 4: Confirm/correct + diary persistence
**Goal**: Users can review, correct, and confirm a decomposed meal, and the confirmed entry is calculated deterministically and durably saved — this is where the product becomes trustworthy per Core Value.
**Depends on**: Phase 3
**Requirements**: CORRECT-01, CORRECT-02, CORRECT-03, CORRECT-04, CORRECT-05, CORRECT-06, CORRECT-07, CORRECT-08, CALC-01, CALC-02, DIARY-01
**Success Criteria** (what must be TRUE):
  1. User receives a card showing each decomposed component, its gram estimate, and its matched FDC record, and can confirm it as-is.
  2. User can correct the decomposition: swap the matched FDC candidate for one of the other 2, adjust grams (±10 g buttons or a typed number), remove a component, or add a missing component by text (which is matched against FDC the same way as the original decomposition).
  3. Correction draft state is stored in Postgres (not in process memory) and is unchanged after restarting the bot process mid-correction.
  4. After confirmation, final calories/protein/fat/carbs/sugar are computed purely mathematically (grams × FDC per-100g values, no LLM) and saved to the user's diary for the correct day per their timezone; a missing sugar value displays "нет данных," never 0 or a guessed number.
  5. User can edit or delete an already-saved diary entry using the same correction mechanics used pre-save.
**Plans**: TBD

### Phase 5: Diary views
**Goal**: Users can see how their day and week compare against their calculated targets.
**Depends on**: Phase 4
**Requirements**: DIARY-02, DIARY-03
**Success Criteria** (what must be TRUE):
  1. User can view their diary for a given day: the list of logged entries and totals against target КБЖУ.
  2. User can view a simple weekly summary: daily totals against targets across the past 7 days.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation — data + domain math | 8/8 | Complete   | 2026-08-11 |
| 2. Bot skeleton + onboarding | 0/TBD | Not started | - |
| 3. Voice pipeline | 0/TBD | Not started | - |
| 4. Confirm/correct + diary persistence | 0/TBD | Not started | - |
| 5. Diary views | 0/TBD | Not started | - |
