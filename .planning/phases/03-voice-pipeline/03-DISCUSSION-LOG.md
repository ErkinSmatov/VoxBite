# Phase 3: Voice pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-12
**Phase:** 3-voice-pipeline
**Areas discussed:** STT provider, Run mode, Cost control, End-of-phase user output

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| STT-провайдер | OpenAI vs Yandex SpeechKit; the STATE.md MEDIUM-confidence flag | ✓ |
| Режим запуска | Long polling on the owner's machine vs deploy + webhook | ✓ |
| Контроль расходов | Audio length cap, per-user daily cap, spend visibility | ✓ |
| Что видит юзер в конце | Phase 3/Phase 4 boundary and where the result is stored | ✓ |

**User's choice:** all four areas.

---

## STT provider

### Q1 — What language will beta users actually speak?

| Option | Description | Selected |
|--------|-------------|----------|
| Практически только русский | OpenAI closes it; Kazakh becomes a later phase | |
| Русский + вкрапления казахского | Russian speech, Kazakh dish names (бешбармак, куырдак, шубат) | ✓ |
| Полноценный казахский тоже | Would force Yandex SpeechKit + a second cloud account | |

**Notes:** Claude reframed this immediately: mixed dish names are a rare-vocabulary problem inside Russian, plus a decomposition problem (FDC has no beshbarmak record), not a Kazakh-STT problem. This reframing drove every later STT decision.

### Q2 — Which STT provider for Phase 3?

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI + глоссарий | Existing key and spend cap, zero new setup; Transcriber port keeps Yandex a swap | ✓ |
| Сравнить оба в этой фазе | Honest but adds a cloud account, billing, and phase work | |
| Сразу Yandex SpeechKit | Native RU/KZ but overkill for the actual usage pattern | |

### Q3 — How to satisfy the "~10 real recordings" success criterion?

| Option | Description | Selected |
|--------|-------------|----------|
| Скрипт verify-stt | Phase 1 verify-* house style, gitignored recordings folder | ✓ |
| Просто поговорить с ботом | No script; can't tell an STT error from an LLM error | |
| Скрипт на всю цепочку | verify-pipeline: audio → text → components → FDC candidates | |

**Notes:** Claude flagged that the whole-chain script measures the product's actual Core Value; the owner chose the narrower script. Captured as a deferred idea for Phase 4.

### Q4 — Audio and transcript retention?

| Option | Description | Selected |
|--------|-------------|----------|
| Аудио в памяти, текст в БД | Never on disk, never logged; transcript kept for Phase 4 and debugging | ✓ |
| Ни аудио, ни текст не хранить | Strictest, but no way to see what STT actually heard | |
| Сохранять аудио в бете | Contradicts TECH_SPEC §10 — Claude advised against it | |

### Q5 — Which OpenAI transcription model?

| Option | Description | Selected |
|--------|-------------|----------|
| gpt-4o-transcribe | ~$0.006/min, better on rare words (Claude's recommendation) | |
| gpt-4o-mini-transcribe | ~$0.003/min, weaker on rare words | ✓ |
| Решай сам по verify-stt | Run both in the script and pick empirically | |

**Notes:** Claude stated the disagreement once — at ~10-second messages the saving is ≈$0.0005/message while mini's weak spot is exactly the Kazakh dish names — then proposed an empirical resolution instead of arguing: model held in a single constant, `verify-stt` prints both models' transcripts side by side. Owner's choice stands as the default.

### Q6 — Which Telegram message types count as food input?

| Option | Description | Selected |
|--------|-------------|----------|
| voice + текст | Exactly VOICE-01 and VOICE-04; polite refusal for everything else | ✓ |
| + кружочки (video_note) | Same audio track, slightly more code | |
| Всё, где есть звук | Risk of paying to transcribe a 3-minute mp3 | |

### Q7 — Where does the STT dish-name glossary live?

| Option | Description | Selected |
|--------|-------------|----------|
| Файл в репо | Hand-edited TS list, visible in git history | |
| Таблица в базе | Migration + admin surface for ~20 words | |
| Без глоссария пока | Add words only against real verify-stt failures | ✓ |

### Q8 — Voice contains no food (greeting or silence)?

| Option | Description | Selected |
|--------|-------------|----------|
| Пустой список → вежливый отказ | Empty result is a legitimate answer, no second paid retry | ✓ |
| Ретраить как любой пустой ответ | Simpler logic, pays twice for "привет" | |
| Проверять до LLM | Length heuristic would also swallow an honest "банан" | |

---

## Run mode

### Q1 — Where does the bot run in Phase 3?

| Option | Description | Selected |
|--------|-------------|----------|
| Остаёмся на polling | No webhook timeout, and avoids stacking a first deploy onto the riskiest phase | ✓ |
| Деплоим в этой фазе | Needed only if friends must use it round the clock now | |
| Polling, но на сервере | Uptime without HTTPS/domain/webhook-secret work | |

**Notes:** This explicitly revises Phase 2's D-02, which had expected hosting + setWebhook in Phase 3.

### Q2 — How is idempotency implemented (success criterion 5)?

| Option | Description | Selected |
|--------|-------------|----------|
| Таблица processed_updates | update_id primary key, insert before any paid call | ✓ |
| Ключ по (chat_id, message_id) | Ties idempotency to the draft decision, a different concern | |
| Set в памяти процесса | Dies with the process — fails the exact case it exists for | |

### Q3 — Three voice messages in a row?

| Option | Description | Selected |
|--------|-------------|----------|
| Обрабатываем все три | Honest usage; spend bounded by limits, not by blocking | ✓ |
| Одно за раз на юзера | Hard ceiling but loses real messages | |
| Очередь на юзера | Half a job queue inside the process, which v1 rejected | |

### Q4 — What does the user see during processing?

| Option | Description | Selected |
|--------|-------------|----------|
| Одно сообщение, редактируем его | Clean chat + a stable message_id for Phase 4's keyboard | ✓ |
| Два отдельных сообщения | Simpler, but two messages per meal accumulate | |
| Статус по шагам | Clearer on long waits, more Telegram calls per step | |

### Q5 — Process dies mid-processing?

| Option | Description | Selected |
|--------|-------------|----------|
| Засекать зависшие при старте | Status column; on startup tell the user the run was interrupted | ✓ |
| Автодогонять при старте | Audio isn't stored, so resume is only partial and much harder | |
| Ничего не делать | Accept the silent hang in beta | |

---

## Cost control

**Framing given:** ≈$0.002 per message all-in (STT + LLM + embeddings); the real risk is outliers, not the average.

### Q1 — Audio duration cap?

| Option | Description | Selected |
|--------|-------------|----------|
| 60 секунд | Checked against Telegram's duration field before download and before any paid call | ✓ |
| 120 секунд | More headroom, double the per-message ceiling | |
| Без лимита | An accidentally held mic button is a real scenario | |

### Q2 — Per-user daily message limit?

| Option | Description | Selected |
|--------|-------------|----------|
| Мягкий потолок ~30/сутки | Runaway guard in a constant/env var, not a tariff | ✓ |
| Без лимита в бете | Allowlist + OpenAI spend cap as the only guards | |
| Жёсткий лимит как в тарифе | Subscription counter — explicitly v2 work | |

### Q3 — Which LLM does decomposition?

| Option | Description | Selected |
|--------|-------------|----------|
| OpenAI через AI SDK | generateObject + Zod per STACK.md; one account, one key, one bill | ✓ |
| Напрямую через openai SDK | One less dependency, harder provider swap later | |
| Решай сам | Planner's call per STACK.md | |

### Q4 — Spend visibility?

| Option | Description | Selected |
|--------|-------------|----------|
| Строка в терминал на сообщение | STT seconds + LLM tokens + embeddings + estimated dollars | ✓ |
| Писать расходы в базу | Enables real unit economics (TECH_SPEC §9), more work now | |
| Ничего не считать | Rely on the OpenAI dashboard's spend cap alone | |

---

## End-of-phase user output

### Q1 — What does the bot's final reply look like?

| Option | Description | Selected |
|--------|-------------|----------|
| Текстовая карточка без кнопок | Same content as Phase 4's card, minus the keyboard | ✓ |
| Дебаг-вывод со всеми тремя кандидатами | Shows match quality but reads as a debug dump | |
| Сразу карточка фазы 4 | Pulls Phase 4 into Phase 3 and blurs both acceptance criteria | |

### Q2 — Is the draft persisted in Phase 3?

| Option | Description | Selected |
|--------|-------------|----------|
| Да, пишем черновик сразу | Phase 4 needs a DB draft anyway (Anti-Pattern 4); avoids rewriting the ending | ✓ |
| Нет, только показать | Less schema now, whole draft model moves to Phase 4 | |

### Q3 — Show calculated КБЖУ in the Phase 3 card?

| Option | Description | Selected |
|--------|-------------|----------|
| Нет, только компоненты | Clean phase boundary; unconfirmed numbers read as final | ✓ |
| Да, показать предварительные | Immediate plausibility check, but that's CALC-01 (Phase 4) | |

### Q4 — Component with no plausible FDC match?

| Option | Description | Selected |
|--------|-------------|----------|
| Показать как есть, пометить | Visible "совпадение слабое" marker; Phase 4's picker fixes it | ✓ |
| Выкинуть компонент | Calories silently vanish with no explanation | |
| Забраковать весь разбор | Maddening on a complex dish | |

---

## Claude's Discretion

- The decomposition prompt itself — composite Central Asian dishes broken into FDC-findable ingredients, and explicit user-stated grammage overriding the model's estimate.
- The DECOMP-03 retry mechanics (one stricter retry, then the user-facing failure message), respecting the D-08 carve-out for well-formed empty results.
- Retry/backoff for transient OpenAI failures and the Russian copy for each terminal failure mode.
- Component embedding batching/caching — with the hard constraint that runtime embedding matches the model and dimensions that indexed `fdc_foods`.
- File layout under `src/application/`, `src/adapters/stt/`, `src/adapters/llm/`, `src/bot/handlers/`, and the migrations for the two new tables.
- Test strategy, following the Phase 1/2 pattern.

## Deferred Ideas

- `verify-pipeline` script covering the whole chain in one report — offered, not taken; revisit in Phase 4.
- Yandex SpeechKit adapter for genuine full-Kazakh speech.
- Kazakh dish-name glossary in the STT prompt (seam exists, list empty).
- Hosting + `setWebhook` — deferred a second time.
- Persisted spend ledger / per-tariff unit economics — payment milestone.
- Per-user limits as a subscription tariff — v2.
- BullMQ/Redis — build the seam, not the queue.
