---
phase: 01-foundation-data-domain-math
plan: 02
subsystem: infra
tags: [supabase, postgres, pgvector, openai, secrets, billing, checkpoint]

# Dependency graph
requires: [01-01]
provides:
  - Live Supabase Postgres 17.6 project with pgvector 0.8.2 enabled
  - Git-ignored .env holding a working Session Pooler DATABASE_URL and OPENAI_API_KEY
  - Bounded financial exposure on the OpenAI account before the first bulk embedding run
affects: [01-03, 01-06, 01-07, 01-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Supabase Session Pooler (port 5432 + sslmode=require) chosen over Direct connection (needs IPv6) and Transaction pooler (port 6543, no prepared statements — breaks drizzle-kit migrations)"

key-files:
  created:
    - .env
  modified: []

key-decisions:
  - "D-01 confirmed in practice: managed Supabase cloud Postgres, no local Docker/Postgres — owner has no backend infra experience"
  - "D-02 confirmed: OpenAI is the embedding provider; key scoped to a single dev key named voxbite-dev"
  - "Financial guardrail is layered: capped prepaid balance + auto-recharge OFF is the hard wall; the spend limit is the early-warning layer, because OpenAI documents that limit enforcement is not instantaneous"

# Verification
verification:
  - command: "npm run check-setup"
    result: "exit 0 — SETUP OK"
    evidence: "Postgres version: PostgreSQL 17.6; vector extension: enabled (v0.8.2); OpenAI embeddings: OK (1536 dimensions)"
  - command: "git status --porcelain .env"
    result: "empty — .env is git-ignored, never staged"
  - command: "grep '^DATABASE_URL=' .env"
    result: "exactly 1 active line, matches pooler\\.supabase\\.com:5432 and contains sslmode=require, no placeholder password"
  - command: "grep -R 'sk-proj-' --exclude=.env --exclude-dir=node_modules ."
    result: "only documentation placeholders inside 01-02-PLAN.md — no real key outside .env"

status: complete
---

# Plan 01-02 Summary — External account setup (Supabase + OpenAI)

## What was done

Both tasks were `checkpoint:human-action` gates — browser-only dashboard workflows
that no CLI can perform. The owner executed them; the orchestrator verified the
result against the plan's acceptance criteria rather than accepting the
confirmation at face value.

**Task 1 — Supabase.** A free-tier project was created with the `vector`
extension enabled, and its Session Pooler connection string written to a
git-ignored `.env`. Verified live: `PostgreSQL 17.6`, `pgvector v0.8.2`.

**Task 2 — OpenAI.** An API key was created and stored in `.env`. The owner
confirmed **auto-recharge is OFF** and a **hard spend limit was set** — this
resolves research Assumption A4: the OpenAI UI did still offer a true hard spend
limit, not only a notification-style budget. Verified live: a real embedding call
returns 1536 dimensions.

## Observed environment

| Item | Value |
|---|---|
| Supabase region | `eu-central-1` (Frankfurt), host `aws-0-eu-central-1.pooler.supabase.com` |
| Postgres version | 17.6 |
| pgvector version | 0.8.2 |
| Connection mode | Session Pooler, port 5432, `sslmode=require` |
| OpenAI spend control available | Hard spend limit (A4 resolved — hard limit, not notification-only) |
| OpenAI auto-recharge | OFF |
| Embedding dimensions returned | 1536 |

## Deviations

None. Dashboard labels matched the plan's instructions; no correction is needed
for future phases.

## Notes for later phases

- `.env` contains commented template lines carried over from `.env.example`,
  including one line with the literal `[YOUR-PASSWORD]` placeholder. These are
  comments (`#`-prefixed) and inert. Exactly one **active** `DATABASE_URL` and
  one **active** `OPENAI_API_KEY` line exist. A future acceptance check that
  greps the whole file for `YOUR-PASSWORD` will produce a false positive — it
  should scope the match to uncommented lines.
- Supabase free tier pauses a project after ~7 days idle. If a later phase's
  command suddenly cannot connect, resume the project from the dashboard before
  debugging anything else.
- pgvector 0.8.2 is present, so the HNSW index required by plan 01-03 is
  supported.
