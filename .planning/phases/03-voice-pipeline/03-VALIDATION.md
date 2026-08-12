---
phase: 3
slug: voice-pipeline
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-12
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` → `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.10 (installed, house standard since Phase 1) |
| **Config file** | none — Vitest zero-config defaults, co-located `*.test.ts` files |
| **Quick run command** | `npx vitest run <path>.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~10 seconds (full suite, all fakes — no network, no DB) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <the test file for that task>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite green **plus** `npm run verify-stt` run by the owner against real sample audio (D-04, success criterion 2 — human judgement, not automatable)
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

> Task IDs are filled in by the planner; requirement → test-file mapping below is fixed.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | VOICE-01 | — | Non-voice/non-text input refused before any paid call (D-06) | unit | `npx vitest run src/bot/handlers/voice.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | VOICE-02 | — | Ack sent before pipeline work begins; pipeline never awaited inline | unit | `npx vitest run src/bot/handlers/voice.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | VOICE-03 | T-3 audio handling | Audio never written to disk, never logged (D-05) | unit + `verify-stt` | `npx vitest run src/adapters/stt/openai-transcribe.test.ts` · `npm run verify-stt` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | VOICE-04 | — | Text input reaches the identical pipeline entry point as transcribed voice | unit | `npx vitest run src/application/voice-pipeline.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DECOMP-01 | — | Well-formed multi-item response validates against the Zod schema | unit | `npx vitest run src/adapters/llm/openai-decompose.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DECOMP-02 | — | Single-ingredient input yields exactly one component, never split | unit | `npx vitest run src/application/voice-pipeline.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DECOMP-03 | — | Malformed output retries once then fails gracefully; well-formed-empty does NOT retry (D-08) | unit | `npx vitest run src/adapters/llm/openai-decompose.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | VOICE-04 (idempotency, D-10/D-11) | T-3 duplicate spend | Duplicate `update_id` is a no-op; claim row written before any paid call | unit | `npx vitest run src/application/idempotency.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | DECOMP-01 (card, D-18/D-20/D-21) | — | Weak FDC match flagged, never silently dropped; no КБЖУ numbers | unit | `npx vitest run src/bot/formatting/result-card.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install ai@7.0.62 @ai-sdk/openai@4.0.40 zod@4.4.3` — nothing below compiles until this lands
- [ ] `src/bot/handlers/voice.test.ts` — VOICE-01/02, D-06 content-type gate, D-14 duration cap
- [ ] `src/adapters/stt/openai-transcribe.test.ts` — VOICE-03 (fake client, mirrors `openai-embed.test.ts`)
- [ ] `src/adapters/llm/openai-decompose.test.ts` — DECOMP-01/02/03
- [ ] `src/application/voice-pipeline.test.ts` — VOICE-04, orchestration, DECOMP-02 pipeline contract
- [ ] `src/application/idempotency.test.ts` — `processed_updates` claim/release logic
- [ ] `src/bot/formatting/result-card.test.ts` — D-18/D-20/D-21 card rendering
- [ ] `scripts/verify-stt.ts` — new `verify-*` script (D-04), house style of `verify-matches.ts`, not a Vitest file

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| STT accuracy on real Russian speech with Kazakh dish names | VOICE-03 (success criterion 2) | Transcription quality is a human judgement call; no ground-truth corpus exists and storing user audio was rejected (D-05) | Owner drops ~10 personal voice files into the gitignored samples folder, runs `npm run verify-stt`, reads both models' transcripts side by side (D-03) |
| Decomposition quality on composite dishes (бешбармак, куырдак, плов, манты) | DECOMP-02 | Prompt quality against real speech cannot be asserted with fakes; the shape can, the wisdom cannot | Send real voice/text messages to the bot in Telegram and read the resulting card |
| End-to-end voice → card in Telegram | VOICE-01, VOICE-02 | Requires the real Telegram transport and a real bot token | Run the bot locally (long polling, D-09), send a voice message, confirm ack appears immediately and is edited in place into the card |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-12 (gsd-plan-checker: VERIFICATION PASSED across all 8 plans)

> `wave_0_complete` stays `false` until execution actually installs
> `ai` / `@ai-sdk/openai` / `zod` and creates the test files (plan 03-01, Task 1).
