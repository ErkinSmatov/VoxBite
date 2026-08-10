# Pitfalls Research

**Domain:** Voice-to-structured-data pipeline (Telegram bot) + LLM decomposition + embedding-matched nutrition database (USDA FDC) + solo non-backend developer
**Researched:** 2026-08-10
**Confidence:** MEDIUM-HIGH (grounded in current provider docs/community sources for Telegram/LLM/webhook mechanics; nutrition-matching and non-dev-founder pitfalls are MEDIUM — pattern-level consensus, not VoxBite-specific case studies)

This file extends TECH_SPEC.md §11 ("Open questions and risks") rather than duplicating it. Where a pitfall below maps to an existing open question in §11, that's noted explicitly.

---

## Critical Pitfalls

### Pitfall 1: LLM JSON output trusted without runtime schema validation

**What goes wrong:**
The decomposition prompt (TECH_SPEC §5.2-5.3) asks the LLM for `{"items": [{"component", "component_en", "grams"}]}`. Teams often treat "I used JSON mode / asked nicely for JSON" as a guarantee and pipe the response straight into the matching/calculation pipeline. The model can still return an empty `items` array, drop `component_en`, return `grams` as a string ("about 80"), nest an extra wrapper object, or (for providers without strict schema support) return prose before/after the JSON.

**Why it happens:**
"Structured output" and "JSON mode" are delivery-format guarantees, not logic guarantees — every major provider now supports constrained decoding for schema conformance, but a syntactically valid JSON object with a hallucinated or missing field is still schema-conformant and still wrong. A dev new to LLM APIs conflates "valid JSON" with "correct/complete data."

**How to avoid:**
- Use the provider's structured-output / function-calling mode with a strict JSON Schema (not prompt-only JSON), which is supported by OpenAI, Anthropic, and Gemini as of 2026.
- Validate every response against a schema validator (e.g., Zod in TS) before it touches business logic — reject and retry (once, with a stricter/clarifying follow-up prompt) on validation failure, per TECH_SPEC §5.3.
- Enforce field-level sanity, not just shape: `grams` must be numeric and within a plausible bound (e.g., 1–2000g per component); `items` must be non-empty; `component`/`component_en` must be non-empty strings.
- On second failure, fail gracefully to the user ("не смог разобрать, опиши иначе") rather than surfacing a broken/partial diary entry.

**Warning signs:**
Occasional silent diary entries with 0g or missing components; crashes deep in the calculation step instead of at the validation boundary; support requests like "the bot said I ate 0 calories."

**Phase to address:**
Early — this is core pipeline plumbing, must exist before the correction UX phase (correction assumes it's correcting *valid* structured data, not patching malformed data).

---

### Pitfall 2: No sanity bounds on LLM-estimated grams (hallucinated portions)

**What goes wrong:**
LLM portion-size estimation is inherently a guess when the user doesn't state weight explicitly. Models can produce absurd values (banana = 1200g, olive oil = 300g) especially for less common dishes, non-Russian/Kazakh dish names, or ambiguous voice transcriptions ("съел плов" with no quantity cues). Because the final calculation is math on `grams × nutrient_per_100g` (TECH_SPEC §5.7), a bad gram estimate directly and silently produces a wrong calorie total — there's no downstream check that would catch it, since the math itself is correct.

**Why it happens:**
The team correctly moved arithmetic out of the LLM (TECH_SPEC decision), but portion *estimation* is still LLM-driven and unconstrained. "The math is deterministic" gets conflated with "the whole pipeline is trustworthy."

**How to avoid:**
- Define per-food-category plausibility ranges (e.g., a single "component" between 5g and 1000g by default; flag outliers for explicit user confirmation rather than auto-accepting).
- Show the estimated grams prominently in the confirmation card (already planned, TECH_SPEC §3.3) so the human is the actual sanity check — but also add a soft server-side warning state ("necheck this — looks unusually high") for extreme values, since users skim confirmation cards.
- Log every (transcript → decomposition) pair so egregious cases can be reviewed and used to refine the prompt over time.

**Warning signs:**
User reports of wildly wrong calorie totals; diary totals with single entries >2000 kcal from ordinary meals; no logs to even notice this is happening.

**Phase to address:**
Early (bounds + logging) for the core voice→diary phase; refinement of category-specific bounds can be iterated in a later feature-polish phase once real transcript data exists.

---

### Pitfall 3: LLM non-determinism causes inconsistent decomposition for the same input

**What goes wrong:**
The same dish name ("лазанья") can decompose differently across calls — different ingredient lists, different gram splits, different English translations — because LLM sampling is not fully deterministic even at low temperature. Users who log the same meal on different days get different calorie totals for what they consider "the same thing," which erodes trust in the tool faster than an openly-imperfect-but-consistent estimate would.

**Why it happens:**
Non-determinism is treated as a training-data/model quirk rather than a product-facing consistency problem that needs explicit product-level mitigation (caching, presets, or explicit acknowledgment to the user).

**How to avoid:**
- Set `temperature` low (0-0.2) for the decomposition call to reduce variance — this doesn't eliminate it, so don't rely on it alone.
- Consider a "recent meals" shortcut: if the transcript is very similar to a previous entry, offer "same as [date]?" instead of re-running full decomposition — cheaper and more consistent.
- Don't promise precision the pipeline can't deliver — the confirmation-card UX already surfaces the breakdown for correction, which is the real mitigation; make sure product copy sets expectations ("estimate," not "exact lab measurement").

**Warning signs:**
Same voice message replayed in testing gives visibly different ingredient breakdowns run-to-run.

**Phase to address:**
Early architecture phase for the temperature/prompt setting; the "recent meals" shortcut is a later feature-phase nice-to-have, not a blocker.

---

### Pitfall 4: Embedding match picks the wrong preparation state (raw vs. cooked)

**What goes wrong:**
USDA FDC contains separate entries for raw and cooked versions of the same food (e.g., "Chicken, broiler, breast, meat only, raw" vs. "…cooked, roasted"), and the calorie/macro density differs substantially between them because cooking changes water content, not caloric energy — mismatching raw/cooked weight and nutrient basis can shift calorie/macro output by roughly 15-40%, which is a severe, silent accuracy failure directly at the core value of the product ("точность распознавания... должна работать надёжно").
An embedding built from the food name alone will often surface raw and cooked variants as similarly "close" semantically, especially since LLM output rarely specifies preparation state explicitly, and the user's spoken description ("фарш говяжий" — ground beef) doesn't disambiguate raw-purchased vs. cooked-eaten weight either.

**Why it happens:**
Embedding similarity captures "what food is this" well but not "in what state/weight was it when the user ate/weighed it" — that's a structured attribute, not a semantic one, and it's easy to assume semantic closeness implies nutritional correctness.

**How to avoid:**
- Have the LLM decomposition step explicitly tag each component with a `state` field (raw/cooked/prepared — best-effort), not just name + grams, so it can bias/filter FDC candidates toward matching preparation state, not just name similarity.
- Default assumption for ambiguous cases should be **as-eaten/cooked weight** (since users report what they ate, not what they bought raw) — and the retrieved FDC candidate's nutrient basis must match that assumption, or the UI must make the mismatch visible (e.g., show "raw" vs "cooked" as a visible attribute in the candidate picker, not just the bare FDC description string).
- Do not apply generic shrinkage/conversion ratios (e.g., a flat "25% cooking loss") across all foods and methods — measured shrinkage varies by food and cooking method (e.g., ground beef loses ~25% pan-fried vs. ~15% baked) and a single hardcoded factor will be systematically wrong for many foods; prefer picking the FDC entry whose stated state already matches, over trying to convert weights in application code.
- Surface the FDC description text (which usually states raw/cooked/method) directly in the candidate card so the user's correction step (TECH_SPEC §5.6) can catch state mismatches the algorithm missed — this is the practical safety net for MVP.

**Warning signs:**
Manual QA on ~20 varied real meals shows plausible-looking but systematically off totals (e.g., consistently ~20-30% high or low vs. known reference values) that don't correlate with obviously wrong ingredient identification — a common tell for the raw/cooked mixup specifically since ingredient *name* recognition looks correct.

**Phase to address:**
Early — this must be validated during the FDC indexing/embedding-search phase (TECH_SPEC §5.5), before building the correction UX on top of it, because it's a systematic accuracy bug that correction UX alone won't reliably catch (the user has no reference to know the FDC entry state is wrong).

---

### Pitfall 5: Top-3 embedding candidates are near-duplicates, not meaningfully diverse choices

**What goes wrong:**
Naive top-k nearest-neighbor retrieval on embeddings frequently returns near-duplicate entries (e.g., three USDA cuts of chicken breast that differ only in trace mineral fortification or brand-adjacent naming) rather than three *meaningfully different, useful* options. The correction UX (TECH_SPEC §5.6, "выбор среди 3 кандидатов") assumes the 3 candidates represent real decision points for the user — if all 3 are near-identical, the correction mechanism provides no real value and the true correct answer (a genuinely different variant) may not appear in the list at all.

**Why it happens:**
Pure vector similarity search optimizes for "closest by embedding distance," which clusters near-duplicates together; it doesn't optimize for showing a diverse, decision-useful set.

**How to avoid:**
- Apply diversity-aware re-ranking (e.g., Maximal Marginal Relevance) over a wider initial candidate pool (retrieve top ~10-15, then select 3 that balance relevance and diversity) instead of naively taking literal top-3 nearest neighbors.
- Consider hybrid retrieval (embedding similarity + lexical/keyword filtering) for cases where exact-term matches exist in FDC but rank lower semantically — pure dense retrieval can under-rank exact matches that a keyword search would surface immediately.
- During the FDC indexing phase, manually spot-check candidate sets for ~30-50 common Russian/Kazakh dish ingredients to see whether the top-3 are actually diverse and whether the "correct" entry is reliably in the set (a basic recall@3 sanity check, not a formal eval framework).

**Warning signs:**
Manual testing shows the 3 candidates for a given ingredient are visually/nutritionally near-identical; users report "none of these are right" more than expected.

**Phase to address:**
Early — during FDC indexing/embedding-search build, before the correction UX phase locks in a "pick from 3" interaction pattern that depends on those 3 being useful.

---

### Pitfall 6: Self-translation by the LLM introduces silent matching failures

**What goes wrong:**
TECH_SPEC §5.4 has the LLM translate `component` to `component_en` in the same decomposition call ("дешевле и надёжнее отдельного шага перевода"). This is a reasonable cost/complexity tradeoff, but it means translation quality is never independently checked — a mistranslated or overly literal `component_en` (e.g., a regional Kazakh dish name translated to an awkward or wrong English phrase) will produce a bad embedding, which produces bad FDC candidates, and nothing downstream flags this as a translation problem — it just looks like "the matching is bad," making it hard to diagnose.

**Why it happens:**
Combining translation and decomposition in one call is the right cost call, but the pipeline needs to acknowledge translation is now an untested dependency of matching quality, not just log it and hope.

**How to avoid:**
- Log `component` (source language) alongside `component_en` (LLM's translation) and the resulting FDC candidates for every request during early testing, so translation failures are visible and diagnosable, not indistinguishable from "matching failures."
- For known-tricky cases (regional dishes, loanwords, transliterated brand names), consider a small curated glossary/override table that bypasses LLM translation for common dish components (cheap, deterministic, and removes an entire failure class for the highest-frequency ingredients).
- Don't silently assume the translation step "just works" because English output looks fluent — fluency is not correctness for a to-be-embedded search key.

**Warning signs:**
FDC candidates that are semantically unrelated to the spoken dish despite `component_en` looking like reasonable English; matching quality that varies a lot between Russian- and Kazakh-language voice messages without an obvious pattern.

**Phase to address:**
Early (logging/observability) during the core voice pipeline phase; glossary/override table can be a later refinement once real usage data shows which translations fail most often.

---

### Pitfall 7: Missing nutrient fields (especially sugar) silently coerced to zero

**What goes wrong:**
Not all USDA FDC entries — especially Foundation Foods for raw/whole ingredients — include a sugar value. A common implementation shortcut is to default missing fields to `0` in the summation code (`SUM(sugar_g) OR 0`), which silently produces a "0g sugar" result that looks like real data but is actually "we don't know." This directly contradicts an explicit product requirement already identified in TECH_SPEC §5.8 and PROJECT.md.

**Why it happens:**
It's the path of least resistance in aggregation code (`COALESCE(sugar, 0)` is one line; propagating "unknown" through a sum and rendering it distinctly is more work) and it's easy to not notice during testing if test meals happen to hit entries that do have sugar data.

**How to avoid:**
- Model "missing sugar" as `null`/`unknown`, not `0`, all the way through the pipeline — the final diary record must distinguish "0g sugar" from "sugar unknown for this component."
- At the diary-total level: if *any* component's sugar is unknown, the total sugar for that meal must be shown as "нет данных" or "≥Xg (частично неизвестно)," not as a clean number that implies completeness.
- Add this as an explicit test case: construct/select a test meal that includes at least one FDC entry with no sugar field and verify the UI shows "no data," not "0g."

**Warning signs:**
Sugar totals that are suspiciously round/low across many entries; no test coverage for FDC entries with null nutrient fields.

**Phase to address:**
Early — part of the math/calculation phase (TECH_SPEC §5.7-5.8), since this is a data-modeling decision (null vs. 0) that's expensive to retrofit once the diary schema and display logic are built around a plain numeric total.

---

### Pitfall 8: Webhook chosen without understanding its operational requirements (or polling chosen and outgrown)

**What goes wrong:**
Webhooks require a publicly reachable HTTPS endpoint with a valid TLS certificate on an allowed port (443/80/88/8443); common failure causes are invalid/self-signed certs, wrong port, redirects on the webhook URL, non-200 responses, or firewall/IP blocking — for a first-time backend developer, TLS/cert setup on a VPS is a real early stumbling block, not a footnote. Conversely, if long polling is chosen for simplicity, only one polling process may hold the connection at a time (a second instance causes `409 Conflict`), which silently breaks zero-downtime deploys — restarting the bot process during a deploy creates a real (if short) gap where updates aren't received, and running two environments (staging + prod) against the same bot token doesn't work.

**Why it happens:**
Polling looks simpler to a frontend developer (no public endpoint, no certs) and is the natural first choice, but its deploy/scaling tradeoffs aren't obvious until you hit them in production. Webhook, conversely, looks harder upfront (certs, public endpoint) but is actually more production-appropriate for a service that will eventually run releases without downtime.

**How to avoid:**
- Use webhook in production once a domain + TLS (e.g., via a reverse proxy like Caddy/nginx with Let's Encrypt, or a managed platform with automatic HTTPS) is available — this is the right call for VoxBite given eventual notification/payment webhooks are already in the architecture (TECH_SPEC §7.2, §8).
- Use polling only for local development, and design the webhook handler to be stateless from the start (no in-memory session data tied to a single process) so it works correctly behind a load balancer / across restarts later.
- Document the TLS/webhook setup step-by-step for the non-backend owner (per CLAUDE.md's explicit instruction), including how to verify the webhook is correctly registered (`getWebhookInfo`) and how to debug common failures (wrong port, self-signed cert).

**Warning signs:**
Bot goes silent after a deploy and comes back after manual restart (classic polling-conflict symptom); `getWebhookInfo` shows a non-empty `last_error_message`.

**Phase to address:**
Early architecture phase — this is a foundational infra decision that affects how the bot handler, deploy process, and eventual payment/webhook integrations (§7.2) are all built; expensive to switch later.

---

### Pitfall 9: Voice file handling assumptions break across STT providers and Telegram limits

**What goes wrong:**
Telegram delivers voice messages as OGG files encoded with the OPUS codec. Not every STT provider accepts OGG/OPUS directly — OpenAI's Whisper API's officially documented supported formats are mp3, mp4, mpeg, mpga, m4a, wav, and webm (OGG is not on that official list, even though some implementations report it working informally) — so a dev who assumes "just forward the Telegram file to Whisper" may get inconsistent behavior across audio, or may need an FFmpeg conversion step that wasn't budgeted for in the architecture. Separately, Telegram's Bot API `getFile` has a hard **20MB download limit** for files fetched by bots (distinct from the up-to-50MB upload limit mentioned for *sending* voice messages) — an unusually long voice message could exceed this and fail to download entirely, with no automatic fallback unless the code explicitly handles it.
Also: privacy-conscious users can restrict voice messages from non-contacts/bots, which can prevent the bot from ever receiving a voice message from certain users — the failure needs a clear, actionable error message, not a silent hang.

**Why it happens:**
"Telegram sends OGG, provider docs mention audio support" gets treated as "it'll just work" without checking the provider's actual supported-format list or file-size ceiling, since these details are easy to miss until a real large/edge-case file hits production.

**How to avoid:**
- Confirm the actual, current supported input formats for whichever STT provider is finally chosen (Whisper API, Yandex SpeechKit, Google STT — per TECH_SPEC's open question §11.3) — do not assume OGG/OPUS "just works" without testing it directly against the provider before locking in the architecture.
- If conversion is needed, budget an FFmpeg (or provider SDK equivalent) conversion step in the voice-processing worker from day one, not as a later patch.
- Enforce a maximum voice message duration/size at the bot layer (reject with a clear message: "голосовое слишком длинное, до ~2 минут") rather than attempting to process something that will fail the 20MB `getFile` ceiling deep in the pipeline.
- Handle `VOICE_MESSAGES_FORBIDDEN`-style errors gracefully with a clear user-facing message pointing to the privacy setting, rather than a silent failure.

**Warning signs:**
Random STT failures that correlate with longer voice messages; STT errors that only reproduce with certain devices/Telegram clients' encoding quirks.

**Phase to address:**
Early — must be resolved as part of finalizing the STT provider choice (TECH_SPEC §11.3, explicitly an open question already) before the voice-processing worker is built, since format/size handling is architectural, not a UI nicety.

---

### Pitfall 10: Multi-step correction flow loses state across restarts/instances or hits callback_data limits

**What goes wrong:**
The planned correction UX (TECH_SPEC §5.6) is inherently multi-step and stateful: pick a candidate for ingredient N, adjust its grams, possibly add/remove components — all before final confirmation. Two common failure modes: (1) storing this in-memory (a JS object keyed by user ID) works fine in a single dev process but loses all in-progress corrections on every deploy/restart/crash, silently discarding a user's edits with no error message; (2) Telegram's `callback_data` payload is capped at **1-64 bytes**, so naive designs that try to encode rich state (which ingredient, which candidate, which meal) directly into the callback string will break or need constant workarounds once more than a couple of fields are needed.

**Why it happens:**
In-memory state is the fastest thing to build and works perfectly in local testing (no restarts happen mid-session); the `callback_data` size limit is easy to not discover until a real multi-field correction flow is built and starts truncating/failing.

**How to avoid:**
- Persist in-progress corrections (draft meal + per-component candidate/grams state) in Postgres, keyed by user + draft ID, from the start — not in-memory — so a deploy or crash mid-correction doesn't silently lose the user's edits (this is consistent with TECH_SPEC §4's plan to persist a "draft" record).
- Keep `callback_data` short and opaque: encode only a short reference ID (e.g., `draft_id:component_idx:action`) and look up the actual state server-side, rather than trying to cram structured data into the 64-byte string.
- Guard against double-taps / rapid repeated button presses on the same message (e.g., ignore a callback if the message was already edited by a prior callback within the last second, or make each action idempotent against the current draft state) — Telegram delivers callback queries at-least-once under retry/latency conditions, and users double-tap.

**Warning signs:**
"Lost my correction after the bot restarted" reports; `Bad Request: BUTTON_DATA_INVALID` errors in logs; duplicate/inconsistent state after fast repeated taps.

**Phase to address:**
Draft-state persistence: early, as part of the core voice→diary architecture (it's a schema/architecture decision, not a UI detail). `callback_data` design conventions: early, before the correction UX feature phase is built, so the pattern doesn't need to be redesigned mid-implementation.

---

### Pitfall 11: No idempotency on voice processing → duplicate LLM/STT calls and duplicate diary entries

**What goes wrong:**
Telegram webhooks and any queue/retry logic in the architecture (TECH_SPEC §4) use at-least-once delivery semantics — duplicates are expected, not exceptional, especially under network blips, deploys, or worker crashes mid-processing. Without an idempotency mechanism, this manifests concretely as: the same voice message triggering STT+LLM+embedding calls twice (double API cost for that message) if the webhook is retried, or — worse — a duplicate diary entry if a retry re-runs the "save to diary" step after a first attempt actually succeeded but crashed before acknowledging.

**Why it happens:**
This failure mode doesn't show up in local manual testing (one message, one straightforward run) — it only appears under real network conditions (timeouts, restarts during a request), which a first-time backend developer typically hasn't been exposed to and won't think to test for.

**How to avoid:**
- Use Telegram's `update_id` (or the voice message's `file_unique_id` + timestamp) as an idempotency key: before processing, check/record that this update hasn't already been processed or is already in-flight, and skip if so.
- Mark work as "in progress" / "done" in the database *before* triggering side effects that are hard to undo (saving to diary, decrementing voice-message quota) so a crash-and-retry doesn't double-apply them — write state first, then act, and make the "act" step check current state before re-doing it.
- If a job queue is introduced later (TECH_SPEC §4 mentions this as an optional MVP upgrade), make sure the job payload includes enough identity info to dedupe, and prefer queue systems/patterns with built-in dedupe (e.g., BullMQ job IDs) over ad hoc handling.

**Warning signs:**
Occasional duplicate diary entries for a single voice message with no user action; LLM/STT provider usage dashboards showing more calls than distinct voice messages received.

**Phase to address:**
Early — part of the core voice-processing architecture, because retrofitting idempotency after diary/quota logic is already built around "one call = one effect" is a meaningful rework, not a small patch.

---

### Pitfall 12: Secrets handling and cost-control treated as afterthoughts by a first-time backend developer

**What goes wrong:**
Two related risks compound for a developer who has never run a service with paid external APIs: (1) API keys/bot tokens end up hardcoded or committed to git (a `.env` accidentally force-added during a debugging session, or a token pasted into a shared chat/doc) — once pushed, the secret must be considered compromised even after deletion, since git history retains it and scraper bots can find exposed keys within hours; (2) with no per-user or global rate/cost limits, a bug (e.g., a retry loop, or the LLM decomposition being re-triggered by a duplicate webhook — see Pitfall 11) or simply higher-than-expected usage during closed beta can produce a surprising bill, since a single uncapped path across STT + LLM + N embedding calls per voice message has no ceiling.

**Why it happens:**
Neither risk is visible until it's already a problem — secrets work fine locally whether or not they're in `.env` vs. hardcoded, and cost only becomes visible on the monthly bill, by which point the damage (leaked key, or overspend) is done. A developer without backend background has no default instinct to treat these as "must design for before shipping," per CLAUDE.md's explicit callout that costly/irreversible actions need advance explanation.

**How to avoid:**
- All keys/tokens (Telegram bot token, STT/LLM/embedding provider keys, payment provider keys) live only in environment variables / a secrets manager, never in code or committed config — `.gitignore` must cover `.env*` (with a tracked `.env.example` containing placeholder keys only) from the very first commit, and a pre-commit secret scanner (e.g., gitleaks) should be wired in early, not added retroactively.
- Set hard usage guardrails before opening the bot to real (even friend/beta) users: per-user monthly voice-message quota is already planned (TECH_SPEC §3.5, §9) — make sure it's enforced server-side from day one, not just documented as a plan; additionally set provider-side spend alerts/hard caps (most LLM/STT providers support a monthly budget cap) as a second independent safety net.
- Compute actual per-voice-message cost (STT + LLM decomposition + N embedding calls) once real providers are chosen, before finalizing subscription pricing/limits — this is already flagged as an explicit open question in TECH_SPEC §9/§11.5; treat it as a blocking task, not a "figure it out later."

**Warning signs:**
A `git log -p -- '*.env'` (or a secret-scanning tool run retroactively) turning up a committed key; a provider bill for a given month that's disproportionate to actual voice-message volume in the diary table.

**Phase to address:**
Immediately, at project setup (before the first commit with any real code) for secrets hygiene; usage guardrails/quota enforcement should land in the same phase as the core voice-processing loop, not deferred to the payments phase — otherwise the free/beta period itself is the uncapped-cost risk window.

---

### Pitfall 13: No observability into the pipeline makes failures undebuggable for a non-backend developer

**What goes wrong:**
When STT misheard a word, or the LLM decomposition produced a strange result, or the embedding match picked a bad FDC candidate, there's no way to tell *which stage* failed after the fact unless every stage's input/output is logged. A developer without backend experience is especially exposed here: debugging "the bot said something wrong" without structured logs means guessing, re-running manually, or asking the LLM/AI assistant to guess blind — none of which scale past the first few bug reports.

**Why it happens:**
Logging feels like "extra work" relative to shipping the next feature, and its absence isn't felt until the first confusing bug report arrives — by which point the failing request's context is already gone.

**How to avoid:**
- Log each pipeline stage's input and output for every processed voice message (transcript, decomposition JSON, FDC candidates + scores, final calculation) with a shared request/draft ID — structured logs (JSON lines), not just `console.log` scattered ad hoc, from day one.
- Since audio itself shouldn't be retained (TECH_SPEC §10 privacy constraint), the transcript + structured intermediate outputs *are* the debugging trail — make sure they're retained long enough to debug (e.g., 30 days) even though raw audio is deleted immediately after transcription.
- Add a minimal error-tracking integration (even a free tier of Sentry or similar) so exceptions in the worker surface somewhere visible, instead of only appearing in a VPS log file the developer has to know to go check.

**Warning signs:**
Bug reports the developer can't reproduce or diagnose without asking the user for a screenshot and guessing; realizing after the fact that the relevant request's data is already gone.

**Phase to address:**
Early — logging/observability should be built alongside the core voice-processing pipeline (not bolted on after issues start appearing), since it's the primary tool a non-backend developer will have for diagnosing problems in every subsequent phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Process voice messages synchronously inside the webhook handler, no queue (TECH_SPEC §4 explicitly allows this for MVP) | Simpler code, faster to ship | No retry safety net if an external API call hangs/fails mid-chain; webhook response deadline risk under Telegram's expectations | Acceptable for closed beta with a handful of users, as long as retry-at-code-level and idempotency (Pitfall 11) are still handled — must not be the excuse to skip idempotency |
| In-memory correction-flow state instead of persisted drafts | Fast to build, no schema needed | Silent data loss on every deploy/restart (Pitfall 10) | Never acceptable beyond local dev/prototyping |
| Coalescing missing nutrient fields (esp. sugar) to 0 | One-line aggregation code | Silently violates an explicit product requirement (TECH_SPEC §5.8) and produces false-confidence numbers | Never acceptable |
| Skipping structured-output validation because "the model usually gets it right" | Faster initial implementation | Rare but real malformed/hallucinated responses reach the diary uncorrected (Pitfall 1) | Never acceptable past local dev |
| Hardcoding cooking-loss/shrinkage percentages instead of relying on matched FDC state | Quick to implement, feels "more accurate" | Systematically wrong across foods/methods that don't match the assumed ratio (Pitfall 4) | Acceptable only as a documented, visible fallback when no state-matched FDC entry exists at all — never as the default path |
| Using long polling because it's simpler to start | No TLS/domain setup needed on day one | Deploy-time downtime, single-process constraint, doesn't scale to later multi-instance/webhook-based payment integration (Pitfall 8) | Acceptable for local development only |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|------------------|-------------------|
| Telegram Bot API (voice) | Assuming any STT provider accepts the OGG/OPUS file Telegram delivers | Verify the chosen STT provider's actual supported formats; add an FFmpeg conversion step if needed (Pitfall 9) |
| Telegram Bot API (getFile) | Not handling the 20MB bot file-download ceiling for unusually long voice messages | Cap accepted voice duration client-side with a clear rejection message before hitting the download step |
| Telegram Bot API (callback_data) | Encoding rich state directly into callback_data strings | Keep callback_data to a short opaque reference ID; store real state server-side (Pitfall 10) |
| LLM structured output (OpenAI/Anthropic/Gemini) | Using prompt-only "please return JSON" instead of the provider's native structured-output/function-calling mode | Use strict JSON-schema-constrained structured output where the provider supports it, and still validate at the app layer (Pitfall 1) |
| Embedding provider (gemini-embedding-001 / text-embedding-3-small — open question §11.4) | Assuming top-k nearest neighbor alone yields a useful, diverse candidate set | Retrieve a wider pool and apply diversity-aware re-ranking / hybrid retrieval before presenting 3 candidates (Pitfall 5) |
| Payment provider webhook (Kaspi Pay/local acquirer, TECH_SPEC §7.2) | Trusting a webhook payload without verifying its signature, or activating subscription before the webhook confirms | Verify signature on every incoming payment webhook; never flip subscription status on client-side "user clicked pay" alone (already correctly identified in TECH_SPEC §7.2 — reinforce with idempotent webhook handling, Pitfall 11's pattern applies here too) |
| USDA FDC dataset | Re-downloading/re-indexing on every deploy, or indexing Branded Foods "just in case" | Treat FDC indexing as a one-time/rare offline pipeline (TECH_SPEC §5.5 already specifies this); Foundation + SR Legacy only for v1 |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Sequential (not parallel) embedding calls per ingredient (3-6 per voice message) | Slow response time on multi-component dishes (lasagna-style meals) | Batch/parallelize embedding calls per component instead of awaiting them one-by-one | Noticeable once a meal has 4+ components, at any user count |
| pgvector without an index (exact search) at larger table sizes | Vector search latency creeps up as FDC dataset grows or if Branded Foods is added later | Use an appropriate pgvector index (e.g., HNSW) once table size or latency justifies it; not needed at Foundation+SR Legacy scale (~10-13k rows) per TECH_SPEC §5.5 | Only relevant if/when Branded Foods (~2M rows) is added — explicitly out of scope for v1 |
| Unbounded concurrent voice-processing without a queue | One slow/hanging external API call blocks that user's request indefinitely, and multiple simultaneous users could each trigger their own long-hanging call with no backpressure | Add timeouts on every external API call; consider a queue once concurrent beta users exceeds a handful (TECH_SPEC §4 already flags this as an easy later upgrade) | Beyond a handful of concurrent active users, or if any provider has elevated latency/outages |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing `.env` or hardcoding API keys/tokens | Compromised keys (billing abuse, bot hijack), especially since scraper bots can find exposed keys within hours of a push | `.gitignore` covers `.env*` from first commit; pre-commit secret scanner; rotate immediately if ever exposed (Pitfall 12) |
| Not verifying payment webhook signatures | Anyone could forge a "payment succeeded" webhook and get free access | Verify provider signature on every payment webhook call before changing subscription status (already flagged correctly in TECH_SPEC §7.2) |
| Storing raw audio longer than needed for transcription | Sensitive biometric + health data retained unnecessarily, increasing breach impact | Delete audio immediately after successful transcription, keep only the text transcript (already the plan per TECH_SPEC §10) |
| No rate limiting on bot commands/webhook endpoint | A single abusive or buggy client could drive unbounded LLM/STT spend or DoS the single VPS process | Per-user quota enforcement (already planned) plus basic request-rate guarding at the webhook endpoint |
| Health/diet data treated as ordinary app data (no access controls beyond auth) | Nutrition + weight + goal data is sensitive personal health-adjacent data; a data leak has outsized reputational/legal impact for a paid consumer health product | Scope all diary/onboarding data access strictly to the authenticated user; avoid any admin tooling that dumps all users' health data without a clear operational need and audit trail |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Silent multi-second processing with no feedback | User assumes the bot is broken and resends the voice message, causing duplicate processing (compounds Pitfall 11) | Send an immediate acknowledgment ("Секунду, разбираю 🎧" — already planned, TECH_SPEC §3.2) and ensure duplicate sends within a short window are deduped |
| Presenting 3 near-duplicate FDC candidates as if they were meaningfully different choices | User picks essentially at random, or gives up trusting the correction flow | Diversity-aware candidate selection (Pitfall 5); if no genuinely different candidate exists, consider showing fewer than 3 rather than padding with duplicates |
| Showing a clean 0g/0kcal for a nutrient that's actually unknown | False confidence in data that isn't there, undermining trust in the "honest missing data" promise (TECH_SPEC §5.8) | Explicit "нет данных" state, never a bare 0 for missing fields (Pitfall 7) |
| Correction flow losing in-progress edits after a bot restart with no explanation | User re-does work, or worse, silently ends up with a wrong diary entry they think is corrected | Persist draft state (Pitfall 10); if a draft is lost, tell the user explicitly rather than silently discarding |
| Over-promising precision in bot copy ("точный подсчёт калорий") | Sets an expectation the pipeline (LLM estimation + embedding matching) cannot fully deliver, causing trust breakdown when estimates are inevitably off | Product copy should frame results as informed estimates from real USDA data, correctable by the user — consistent with the non-medical-device disclaimer already planned (TECH_SPEC §6.5) |

## "Looks Done But Isn't" Checklist

- [ ] **LLM decomposition:** Looks done when a happy-path voice message returns correct JSON — verify: malformed/empty LLM responses are caught by schema validation and retried/gracefully failed, not silently passed through (Pitfall 1).
- [ ] **FDC candidate matching:** Looks done when candidates "look reasonable" for a few tested dishes — verify: raw-vs-cooked state is checked for a deliberately chosen raw/cooked-ambiguous test set (chicken, beef, rice, pasta), and candidate sets are spot-checked for diversity, not just relevance (Pitfalls 4, 5).
- [ ] **Sugar/optional nutrients:** Looks done when a total sugar number displays — verify: a test meal with at least one FDC entry lacking sugar data shows "нет данных," not 0 or a total that silently excludes it without saying so (Pitfall 7).
- [ ] **Correction flow:** Looks done when button taps update the message in manual testing — verify: state survives a server restart mid-correction, and rapid double-taps on the same button don't produce inconsistent state (Pitfall 10).
- [ ] **Webhook setup:** Looks done when the bot responds locally — verify: `getWebhookInfo` shows no pending errors in the actual deployed environment, and a deploy/restart doesn't cause a multi-minute gap in receiving updates (Pitfall 8).
- [ ] **Cost controls:** Looks done when the bot works for a few test messages — verify: a per-user voice-message quota is enforced server-side (not just documented), and provider-side spend alerts/caps are configured before any real beta user gets access (Pitfall 12).
- [ ] **Secrets:** Looks done when the bot runs locally with a working token — verify: `git log` / a secret scan confirms no key ever entered version control, and `.env.example` (placeholders only) is the only tracked env file (Pitfall 12).
- [ ] **Observability:** Looks done when the developer can see console output while testing locally — verify: structured logs for each pipeline stage exist and are queryable/greppable in the deployed environment, not just visible in a local terminal (Pitfall 13).
- [ ] **Duplicate handling:** Looks done when a single voice message produces one diary entry in manual testing — verify: a simulated duplicate webhook delivery (or a forced worker crash-and-retry) does not produce a duplicate diary entry or duplicate paid-API calls (Pitfall 11).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Secret committed to git history | MEDIUM | Rotate the exposed key immediately at the provider (don't just delete the file); treat the old key as permanently compromised; use a history-rewrite tool only if history must be fully scrubbed (rotation is the non-negotiable first step) |
| Missing schema validation shipped, bad data reached diary | LOW-MEDIUM | Add validation now; run a backfill query to find diary entries with 0/null grams or empty component names and flag/notify affected users if the volume is small enough to review manually |
| Raw/cooked mismatch discovered after some usage | MEDIUM | Add the `state` tagging + candidate filtering (Pitfall 4); cannot cleanly "fix" historical diary entries without knowing which ones were affected — consider a one-time notice to beta users that early data may be less accurate, given this is pre-launch/beta |
| In-memory correction state design discovered too late (already built features on top of it) | MEDIUM-HIGH | Migrate draft state to Postgres; requires touching every handler that reads/writes correction state — cheaper to do before building the "add component" and "remove component" sub-flows on top of the same in-memory pattern |
| No idempotency, duplicate diary entries found in production | LOW | Add idempotency key checks going forward; write a one-off cleanup query to de-duplicate existing entries (safe since diary entries have timestamps/content to compare) |
| Cost overrun discovered via a surprising bill | LOW-MEDIUM | Add quota enforcement and provider spend caps immediately; review logs (if observability, Pitfall 13, was already in place) to find the actual cause (retry loop vs. genuine usage) rather than guessing |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| 1. Unvalidated LLM JSON output | Core voice→diary pipeline (early) | Fuzz/malformed-response tests against the validation layer; confirm graceful failure message reaches the user on double-failure |
| 2. Hallucinated gram estimates | Core voice→diary pipeline (early) | Manual test set of ~20 varied real meals checked against plausible ranges |
| 3. Non-deterministic decomposition | Core voice→diary pipeline (early, temperature setting) | Replay the same transcript N times, compare variance |
| 4. Raw vs. cooked FDC mismatch | FDC indexing / embedding-search build (early) | Spot-check raw/cooked-ambiguous foods (chicken, beef, rice) against known reference values |
| 5. Near-duplicate top-3 candidates | FDC indexing / embedding-search build (early) | Manual recall@3 + diversity check on 30-50 common ingredients |
| 6. Silent translation failures | Core voice→diary pipeline (early logging); glossary override (later refinement) | Log review after initial beta usage for Russian/Kazakh dish names with poor matches |
| 7. Sugar/missing nutrient coerced to 0 | Math/calculation phase (early) | Explicit test case with a null-sugar FDC entry verifying "нет данных" display |
| 8. Webhook vs. polling operational gaps | Core architecture / infra setup (early) | `getWebhookInfo` check post-deploy; deploy-and-verify-no-gap test |
| 9. Voice file format/size mismatches | STT provider finalization + voice worker build (early) | Test against provider with real Telegram-delivered OGG/OPUS files, including a long voice message near the size cap |
| 10. Correction-flow state loss / callback_data limits | Core architecture (draft persistence) + Correction UX feature phase (interaction design) | Kill the process mid-correction in a staging environment, confirm state survives; test rapid double-taps |
| 11. No idempotency, duplicate processing | Core voice→diary pipeline (early) | Simulate duplicate webhook delivery / forced retry, confirm no duplicate entry or duplicate paid API call |
| 12. Secrets handling + cost overrun | Project setup (secrets, immediate) + core pipeline phase (quota enforcement, early) | Secret-scan the repo before first push to a remote; verify quota enforcement blocks a test user after N voice messages |
| 13. No observability | Core voice→diary pipeline (early, alongside pipeline build) | Confirm each pipeline stage emits a log line with a shared request ID; confirm logs are accessible in the deployed environment, not just local stdout |

## Sources

- [Structured Output in Production: Getting LLMs to Return Reliable JSON](https://tianpan.co/blog/2025-11-10-structured-output-production-llms)
- [The guide to structured outputs and function calling with LLMs — Agenta Blog](https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms)
- [Structured Output Isn't Reliable Output - Rotascale](https://rotascale.com/blog/structured-output-isnt-reliable-output/)
- [Getting Structured Output From LLMs in 2026](https://projectsupply.in/blog/structured-output-llm-2026)
- [Raw vs Cooked Weight Calorie Difference: Why It Confuses Everyone](https://nutrola.app/en/blog/raw-vs-cooked-weight-calorie-difference-why-it-confuses-everyone)
- [Cooking Weight Conversion: How to Track Nutrition Accurately](https://thelivinglook.com/kitchen-hacks/cooking-weight-conversion)
- [Hybrid Search with Reranking - Qdrant](https://qdrant.tech/documentation/tutorials-basics/reranking-hybrid-search/)
- [Hybrid search and reranking: a deeper look at RAG - Ubuntu](https://ubuntu.com/blog/hybrid-search-and-reranking-a-deeper-look-at-rag)
- [Polling vs Webhook in Telegram Bots — Hostman](https://hostman.com/tutorials/difference-between-polling-and-webhook-in-telegram-bots/)
- [Long Polling vs Webhook — How Telegram Bots Receive Updates — GramIO](https://gramio.dev/updates/webhook)
- [How To Parse Audio Files To OGG (OPUS) For Telegram Bot API](https://shashwatv.com/parse-audio-to-ogg-opus-telegram/)
- [sendVoice — aiogram documentation](https://docs.aiogram.dev/en/dev-3.x/api/methods/send_voice.html)
- [Whisper API file size / format discussion — OpenAI Developer Community](https://community.openai.com/t/whisper-api-increase-file-limit-25-mb/566754)
- [Audio API FAQ — OpenAI Help Center](https://help.openai.com/en/articles/7031512-audio-api-faq)
- [Conversation Bot - Multi-Step Interactions — python-telegram-bot DeepWiki](https://deepwiki.com/python-telegram-bot/python-telegram-bot/5.3-conversation-bot)
- [Telegram Bot API Limitations — Grokipedia](https://grokipedia.com/page/Telegram_Bot_API_Limitations)
- [How to Avoid Runaway LLM Costs](https://hiflylabs.com/blog/2026/7/16/cap-llm-api-use-avoid-runaway-llm-costs)
- [Rate limiting for LLM applications — Portkey](https://portkey.ai/blog/rate-limiting-for-llm-applications/)
- [Rate Limiting AI Agents: Preventing LLM API Exhaustion with a 3-Layer Gateway — TrueFoundry](https://www.truefoundry.com/blog/rate-limiting-ai-agents-preventing-llm-api-exhaustion)
- [Webhook Reliability 2026: Idempotency & Retry Reference](https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026)
- [How to Implement Webhook Idempotency — Hookdeck](https://hookdeck.com/webhooks/guides/implement-webhook-idempotency)
- [Please don't commit .env — DEV Community](https://dev.to/somedood/please-dont-commit-env-3o9h)
- [Stop Committing Secrets to GitHub — Medium](https://medium.com/@kcfreepress/stop-committing-secrets-to-github-how-to-avoid-it-and-how-to-fix-it-if-you-already-did-3a78fbdfbaad)
- Internal: `/Users/smatov/GitLab/VoxBite/TECH_SPEC.md` §5, §7, §8, §9, §10, §11 (cross-referenced throughout above)
- Internal: `/Users/smatov/GitLab/VoxBite/.planning/PROJECT.md`, `/Users/smatov/GitLab/VoxBite/CLAUDE.md`

---
*Pitfalls research for: VoxBite — voice-to-diary Telegram bot with LLM decomposition + USDA FDC embedding matching*
*Researched: 2026-08-10*
