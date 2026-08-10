# Feature Research

**Domain:** Voice-first nutrition/calorie tracking (Telegram bot, USDA FDC-backed)
**Researched:** 2026-08-10
**Confidence:** MEDIUM (WebSearch-sourced, cross-verified across 3+ independent articles/reviews per claim; no Context7/official-docs coverage exists for this consumer-app domain — see Sources)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist in any serious nutrition tracker. Missing these makes the product feel incomplete even if recognition accuracy is excellent.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Log a meal (voice/text/photo) | Baseline function of the category | Already scoped | VoxBite: voice → STT → LLM decomposition. Already Active in PROJECT.md. |
| Confirm/correct before saving | Every competitor lets users fix AI mistakes; “no way to fix it” is the #1 complaint about AI-estimate-only apps like Cal AI | Already scoped | VoxBite §5.6 candidate-swap + grams adjust + add/remove is *more structured* than most competitors' free-text edit box — genuine strength, not just parity. |
| **Edit or delete an already-saved diary entry** | Every mainstream app (MFP, Cronometer, MacroFactor, Cal AI) lets you tap any past entry and fix/remove it — mistakes are found after the fact too, not only at confirm-time | LOW–MEDIUM | **Gap in current Active requirements** — spec only covers correction *before* save (§5.6). Reuses the same correction UI/logic, extended to “open a past entry.” Recommend adding to v1: users *will* make mistakes they notice later (e.g., forgot to log, mis-tapped confirm), and “I can't fix yesterday's entry” breaks trust fast. |
| Daily view: eaten vs. target (calories + macros) | Core feedback loop of every tracker | Already scoped | PROJECT.md Active requirement covers this. |
| **Multi-day / weekly view or trend** | MFP, Cronometer, MacroFactor, Cal AI all show a week view alongside today; users judge progress over days, not one snapshot | LOW–MEDIUM | **Gap in current Active requirements.** Doesn't need charts — even a simple “last 7 days: cal / target” text table in Telegram is enough for v1. Flag for roadmap. |
| **Periodic weight re-entry (not just onboarding)** | Weight-change goals are meaningless without tracking actual weight over time; every competitor treats current weight as a recurring log, not a one-time onboarding field | LOW–MEDIUM | **Gap in current Active requirements** — onboarding captures weight once (§3.2) but there's no requirement to log it again later. Without this, the bot can never tell the user whether the 1 kg/month plan is working, and TDEE/BMR calculated at onboarding silently goes stale. Minimal v1: a `/вес` command or periodic prompt to re-enter weight; recompute targets from latest value. |
| Search/browse own history | Users expect to look back at what they ate on a given day | LOW | Natural consequence of the diary data model; mostly a query, not new architecture. |
| Meal timestamp / rough meal-of-day context | Diary entries implicitly need "when," both for day-boundary math and for user orientation ("what did I eat at lunch") | LOW | Requires timezone capture at onboarding (see Onboarding gaps below) even without the reminders feature that originally motivated it in TECH_SPEC §8. |
| Manual/text food entry fallback (not voice-only) | Voice fails in noisy environments, awkward in public, or when STT mishears; MFP/Cronometer/Cal AI all support typed entry as a fallback even where their headline feature is different | LOW | Telegram text messages are trivially compatible with the *same* LLM decomposition pipeline already built for STT output — effectively free once voice pipeline exists. Recommend explicitly supporting "just type what you ate" as an equal first-class input, not a hidden fallback. |
| Honest handling of missing nutrient data | Users lose trust immediately if an app shows "0g sugar" that is actually "unknown" | Already scoped | PROJECT.md/TECH_SPEC §5.8 already gets this right — this is *correct* practice, worth protecting as a hard requirement, not softening later for UI-tidiness reasons. |
| Legal/medical disclaimer | Standard across the category once a weight-loss/gain goal exists | Already scoped | PROJECT.md Active requirement covers this; TECH_SPEC §6.5 flags it as open (who writes final copy). |

### Differentiators (Competitive Advantage)

Features that set VoxBite apart. Should align with the stated Core Value: **recognition/calculation accuracy over payment/growth features.**

| Feature | Value Proposition | Complexity | Notes |
|---------|--------------------|------------|-------|
| Voice-first, hands-free logging | Most competitors are photo-first (Cal AI) or manual-search-first (MFP); genuinely fewer taps to log a meal while eating/cooking, especially for CIS users who'd otherwise have to translate dish names to search an English-only database | Already scoped | This *is* the product's identity per PROJECT.md — protect it, don't let text-entry or future photo-input become the "real" primary mode. |
| Ingredient-level decomposition of composite dishes | Cal AI and most photo-AI trackers return one lump estimate for "lasagna"; MFP/Cronometer require the *user* to manually build a multi-ingredient recipe. VoxBite auto-decomposes ("лазанья" → pasta + beef + sauce + cheese with grams) with zero manual recipe-building | Already scoped | This is the single biggest technical differentiator and directly serves the "accuracy over fabricated numbers" core value. |
| Real database-backed math (USDA FDC) instead of LLM-guessed numbers | Cal AI's structural weakness, confirmed by multiple reviews: "estimates come from the AI model, not from verified nutritional data... every entry is a prediction, not a lookup," and accuracy drops sharply on mixed/composite meals and larger portions — exactly VoxBite's core scenario (lazanya, plov, burgers) | Already scoped | Verified nutrient values × user-editable grams = auditable, reproducible numbers. This is the credible answer to Cal AI's most-cited weakness. **Caveat:** don't oversell as "exact" — see Anti-Features (false precision). |
| Structured 3-candidate correction (vs. free-text search or "just re-type it") | Cal AI: "you cannot teach it — you can only manually edit the entry afterward, and the AI does not improve." MFP/Cronometer require typing into a full database search. VoxBite's tap-to-swap among 3 pre-ranked FDC candidates is lower friction than both | Already scoped (§5.6) | Genuine UX advantage — keep it as the default correction path; don't let it get replaced by a generic free-text box for engineering convenience. |
| CIS/RU-KZ dish vocabulary handled natively | USDA FDC and most trackers are US/English-centric; regional dishes (плов, лазанья, борщ) aren't in Branded Foods anyway, and generic photo-AI models are weaker on non-Western food photos. Voice + LLM translation-and-decomposition step (§5.4) is tailored to exactly this gap | Already scoped | Directly serves the target market (Kazakhstan) noted in PROJECT.md Context. |
| Transparent uncertainty (missing sugar data shown as "no data," not 0 or guessed) | Directly contradicts the industry norm criticized by nutrition scientists: labels/apps imply false precision when real-world variance is commonly 15–20%+ | Already scoped | Consider extending the *principle*, not just the sugar field: e.g., a one-time disclaimer that "numbers are estimates from verified food data, not lab-exact measurements" protects credibility and preempts the "why don't your numbers match the package" complaint. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems, or that other products get criticized for. Deliberately keep these **out** of VoxBite, including in phases after v1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|----------------|------------------|-------------|
| Color-coded "good/bad" food judgment (Noom's red/yellow/green traffic-light system) | Feels motivating, simple visual cue | Widely and specifically criticized: assigns moral value to food, reported to trigger disordered eating, coaches reportedly messaged users who "ate too much red" even within calorie budget | Show macros/calories neutrally; no color-coded moral labeling. VoxBite already has no coaching layer — keep it that way. |
| Shame-based streaks / "you broke your streak" messaging, red over-budget warnings | Common gamification pattern, assumed to drive retention | Documented as a specific trigger for compulsive tracking and disordered-eating-adjacent behavior; users describe eating-disorder communities forming explicitly around these apps' streak/warning mechanics | If any progress indicator is added later, keep it descriptive ("logged 5 of last 7 days") not punitive; never red/alarm-styled over-budget banners |
| AI "coach" chat that critiques choices or gives personalized diet/health advice | Feels high-value, "personal nutritionist" | Legal exposure (medical/nutrition advice liability) directly conflicts with the already-planned disclaimer that the bot is not a medical device; also the exact pattern criticized in Noom ("coaches" nagging about red foods) | Bot stays a calculator + logger. Any guidance stays limited to the math-derived target already planned (§6), no free-form advice generation. |
| Barcode scanning | Table stakes in MFP/Cronometer/Lose It!, feels like an obvious add | Needs USDA FDC **Branded Foods** (~2M records) to resolve barcodes to specific packaged products — explicitly out of scope for v1 per PROJECT.md ("Branded — не нужен для точности... раздувает объём индексации"). Building barcode UX without the matching dataset behind it would be broken or misleading | Defer to a future phase that also revisits the Branded Foods dataset decision as a bundle, not standalone. |
| Wearable/fitness-tracker sync (Apple Health, steps, exercise calories) | Seems like natural TDEE improvement | Scope creep outside core value (recognition/calc accuracy of *food*); adds a second unreliable data source (device-estimated calorie burn) that can undermine trust in the one number VoxBite controls precisely | Keep TDEE from the fixed activity-level coefficient (§6.2) for v1; revisit only if users specifically request it post-beta. |
| Exercise/workout logging | Common in "all-in-one" fitness apps | Different domain, different UX needs (sets/reps vs. meals), dilutes focus from the stated Core Value | Not part of v1 or near-term roadmap. |
| Hiding subscription price behind a long onboarding quiz before reveal | Common dark pattern (used by Cal AI, reportedly "frustrated many users who felt pricing was hidden") | Erodes trust; actively criticized in the exact competitor closest to VoxBite's use case | Not relevant to v1 (no payment), but record as a design principle for the future payment phase: show pricing early/plainly. |
| Rigid mandatory daily weigh-in with guilt/reminder pressure if skipped | Assumed to improve TDEE tracking | Documented as a trigger for shame/body dissatisfaction in reviews of Noom-style apps | Weight re-entry (recommended as table stakes above) should be user-initiated/lightweight, not a nagging mandatory ritual — consistent with v1 explicitly excluding the reminders/notification feature. |
| Claiming lab-exact calorie/macro precision | Users want certainty, single decimal numbers look authoritative | Nutrition science literature is consistent: even official labels vary from real values by an average ~15-21%, and FDA itself tolerates up to 20% label variance — presenting VoxBite's math as "exact" sets an unmeetable trust bar the moment a user weighs food and compares to a package label | Frame the value prop honestly: "calculated from verified USDA data and your portions" (accurate to a *known, real* database) rather than implying lab-grade precision. Ties directly to the existing "no data ≠ 0" principle already in TECH_SPEC §5.8. |

## Feature Dependencies

```
[Weekly/trend view]
    └──requires──> [Daily diary persisted per entry] (already scoped)

[Periodic weight re-entry]
    └──requires──> [Recompute TDEE/targets from latest weight] (extends §6 formula, already scoped)
    └──enhances──> [Weekly/trend view] (progress-vs-goal becomes visible)

[Edit/delete saved diary entry]
    └──requires──> [Same correction UI/logic as pre-save §5.6] (reuse, not new build)

[Meal timestamp / "today" boundary]
    └──requires──> [Timezone captured at onboarding]
    (needed even without the reminders feature — day-boundary math breaks without it)

[Manual/text entry fallback]
    └──requires──> [Same STT-output → LLM decomposition pipeline] (reuse, not new build)

[Personal correction memory (future differentiator)]
    └──requires──> [Correction history stored per user] (privacy review needed — sensitive health data, see TECH_SPEC §10)

[Barcode scanning] ──conflicts──> [v1 dataset scope: Foundation + SR Legacy only]
    (blocked until/unless Branded Foods dataset decision is revisited)
```

### Dependency Notes

- **Weekly view requires persisted per-entry diary data:** already implied by the Active requirement "бот сохраняет запись в дневник" — no new data model, just a query/aggregation layer added on top.
- **Weight re-entry enhances the weekly view and vice versa:** without both, the bot can calculate a target once at onboarding but never tell the user whether the plan (≤1 kg/month) is actually working — this pairing is what turns the product from "a calculator" into "a tracker."
- **Edit/delete saved entry reuses §5.6 correction mechanics:** this is UI/flow reuse, not a new subsystem — low incremental cost to add now that the correction UI already exists in the plan.
- **Manual text entry reuses the STT→LLM pipeline:** Telegram text messages can be routed to the same decomposition step used for STT output; this is near-zero marginal engineering cost and directly removes a table-stakes gap.
- **Barcode scanning conflicts with the current v1 dataset decision:** Foundation Foods + SR Legacy (~10-13k records) don't cover branded packaged products; don't schedule barcode UX before that dataset decision is revisited as a unit.

## Onboarding Data: What Serious Apps Collect Beyond Sex/Age/Height/Weight/Activity/Goal

Current Active scope (PROJECT.md) collects: sex, age, height, weight, activity level, goal, and desired rate (capped at 1 kg/month). Research across nutrition-app onboarding flows and product guides surfaces additional fields commonly collected by more mature apps — evaluated here for relevance to VoxBite specifically (not a blanket "add everything" list):

| Field | Why other apps collect it | Relevance to VoxBite | Recommendation |
|-------|---------------------------|------------------------|-----------------|
| **Timezone** | Needed to correctly bucket "today's" entries and (later) time reminders | **High** — needed *now* for correct day-boundary math in the diary view, independent of the deferred reminders feature | Add to onboarding v1. Small addition, prevents a real correctness bug (a Kazakhstan user's "today" must not follow server/UTC time). |
| **Pregnancy/breastfeeding status** | Safety gate: apps that calculate weight-loss calorie targets need to detect and block/adjust deficit targets for pregnancy, which has different (usually higher) caloric needs and where deficit dieting is medically inappropriate | **Medium-high** — VoxBite already hard-codes a safety floor (1200/1500 kcal, TECH_SPEC §6.3) for weight loss; a pregnant user selecting "снижение веса" would get a formula-driven deficit target that is not appropriate. This is a real safety gap in an otherwise safety-conscious design. | Consider adding a simple gate/flag, or at minimum strengthen the disclaimer to explicitly exclude pregnancy/breastfeeding from the tool's target-setting logic. Cheap to add, meaningfully reduces risk given goal already touches medical territory. |
| **Dietary pattern (vegetarian/vegan/halal/etc.)** | Used elsewhere to filter recommendations; for VoxBite specifically, more relevant as a *matching quality* signal | **Low-medium** — VoxBite doesn't recommend foods, only logs what's reported, so this isn't needed for the core loop. But it could bias the FDC candidate ranking (e.g., don't default-rank a pork-based FDC record for a self-described halal/vegetarian user's ambiguous ingredient) | Not v1-critical; flag as a possible input to the embedding/candidate-ranking logic in a later phase, not onboarding-blocking. |
| Units preference (metric/imperial) | Standard field in most global apps | **Low** — target market is Kazakhstan (metric), TECH_SPEC already assumes kg/cm throughout | Skip for v1; metric-only is a reasonable, low-risk simplification given the stated target market. |
| Body fat % / body composition | Used by more advanced apps (MacroFactor-tier) for more precise BMR estimates than Mifflin-St Jeor | **Low** — adds onboarding friction for marginal accuracy gain; Mifflin-St Jeor is already the documented, defensible choice (TECH_SPEC §6.1) | Skip for v1 — this is the kind of "differentiator for v2" MacroFactor built its brand on, not a v1 gap. |
| Preferred name/display name | Trivial personalization | **Low** | Telegram already provides a display name/username; no need for a separate field. |

## Correction Flow: How Comparable Apps Handle "The AI Got My Food Wrong"

Research into the closest comparable products (all AI-driven food logging) surfaces a consistent pattern and a consistent failure mode:

- **Cal AI (photo-first, closest direct competitor in spirit):** Correction is limited to manually editing the entry after the fact — "you cannot teach it — you can only manually edit the entry afterward, and the AI does not improve based on your corrections." Reviews describe this as a structural weakness, especially since Cal AI has no verified-database fallback (pure AI estimate), so a "correction" is really just overwriting one guess with a manual guess. (MEDIUM confidence — consistent across multiple independent reviews, not an official source.)
- **MyFitnessPal / Cronometer (database-search-first):** Correction means abandoning the auto-match and manually searching a food database, which is exactly the friction VoxBite's 3-candidate-swap approach is designed to avoid.
- **Cronometer specifically** has a community-driven "report incorrect data" flow for fixing the underlying database entries (not just a personal log correction) — a heavier, crowdsourced-moderation model not appropriate for VoxBite's curated single-source (USDA FDC) v1 scope, but worth knowing as a category pattern if data-quality issues surface post-launch.

**Where VoxBite's planned approach (TECH_SPEC §5.6) already beats the category:** structured 3-candidate tap-to-swap + grams stepper + add/remove component is lower-friction than either "just re-type it" (Cal AI) or "search a database" (MFP/Cronometer). This should be protected as a differentiator, not simplified away during implementation for engineering convenience.

**Where VoxBite has a gap relative to the category:** the correction flow as scoped only covers *pre-save* confirmation (§3.3 step 8). Every reviewed competitor also allows correcting/deleting an *already-saved* diary entry at any later point. This is listed under Table Stakes above and should be added to v1 scope — it is low-complexity reuse of the same correction mechanics, not a new subsystem.

**Not recommended for v1:** a "learning" correction system that improves future AI matching from past corrections. Cal AI explicitly lacks this and it's flagged as a limitation, but building a personalization/feedback loop is materially more complex (needs correction history storage, re-ranking logic, and privacy review given sensitive health data — see TECH_SPEC §10) and isn't required to validate the core hypothesis (recognition/calc accuracy). Worth flagging as a **v2+ differentiator**, not a v1 gap.

## Daily/Weekly Diary View: What's Expected

**Daily (already scoped in PROJECT.md Active requirements — "видит день (съедено vs цель)"):**
- Totals: calories eaten vs. target, and macro breakdown (protein/fat/carb) vs. target — implied by existing requirement.
- List of individual logged items/meals for the day (not just a total) — implied but worth making explicit, since "the day" without a breakdown of *what* contributed to it is a weaker product than every competitor reviewed.
- Ability to open any item from that list to edit/delete (see Table Stakes gap above).

**Weekly (not currently in Active requirements — recommend adding as a lightweight v1 feature, not deferred):**
- Every competitor reviewed (MFP, Cronometer, MacroFactor, Cal AI) surfaces some multi-day view — commonly a 7-day rolling average or simple day-by-day list of totals vs. target.
- For a Telegram bot specifically, this doesn't need to be a chart: a simple formatted text table (day, calories, target, delta) is consistent with the platform and avoids taking on chart-rendering complexity in v1. This is a scoping/complexity note for the roadmap, not a reason to skip the feature.
- Weekly view becomes meaningfully useful only once periodic weight re-entry exists (see Table Stakes and Feature Dependencies above) — without a weight trend, "week of calories vs target" tells the user effort but not outcome.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the core hypothesis (recognition + calculation accuracy, per PROJECT.md Core Value).

- [x] Voice message → STT → LLM decomposition → FDC candidate match → confirm/correct → math calc → save (already Active)
- [x] Onboarding: sex, age, height, weight, activity, goal, capped rate (already Active)
- [x] Daily view: eaten vs. target (already Active)
- [x] Medical/non-device disclaimer (already Active)
- [ ] **Timezone capture at onboarding** — needed for correct "today" boundaries, independent of deferred reminders
- [ ] **Edit/delete an already-saved diary entry** — reuses existing correction mechanics, closes a real gap vs. every competitor reviewed
- [ ] **Manual/text food entry as an equal input alongside voice** — reuses the existing decomposition pipeline; near-zero marginal cost, closes a real gap (voice-only fails in noisy/public contexts)
- [ ] **Simple weekly/multi-day summary view** — text-table sufficient for v1, no charts needed; makes the daily loop meaningful over time

### Add After Validation (v1.x)

Features to add once the core loop (above) is working and validated with the closed beta (owner + friends).

- [ ] **Periodic weight re-entry + target recalculation** — trigger: once users have logged for 2+ weeks and the "did the plan work" question becomes real
- [ ] Dietary-pattern-aware candidate ranking (halal/vegetarian bias in FDC matching) — trigger: if beta testers report FDC candidates that are technically correct but culturally/dietarily wrong
- [ ] Pregnancy/breastfeeding onboarding gate — trigger: before any expansion beyond the closed friends-and-owner beta, given it's a real (if currently low-probability) safety gap

### Future Consideration (v2+)

Features to defer until product-market fit / core hypothesis is validated — consistent with PROJECT.md's Out of Scope reasoning (validate core cycle before expanding).

- [ ] Personal correction memory / learning from past user corrections — why defer: meaningfully more complex (storage, re-ranking, privacy review), not required to validate core value
- [ ] Barcode scanning — why defer: requires the Branded Foods dataset decision (currently explicitly out of scope) to be revisited as a bundle
- [ ] Photo-based logging as an additional input mode — why defer: different technical pipeline (vision model), risks diluting the voice-first identity and the "verified DB not AI-guess" differentiator if not done carefully
- [ ] Adaptive/auto-adjusting TDEE (MacroFactor-style) — why defer: valuable but meaningfully more complex than the fixed-coefficient TDEE already scoped (§6.2); a v2 differentiator once the core loop is validated
- [ ] Wearable/fitness-tracker sync — why defer: out of core value, adds an unreliable second data source
- [ ] Payment/subscription, reminders — already explicitly Out of Scope in PROJECT.md

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|----------------------|----------|
| Voice log → confirm/correct → save (core loop) | HIGH | HIGH | P1 (already scoped) |
| Daily eaten-vs-target view | HIGH | LOW | P1 (already scoped) |
| Timezone capture | MEDIUM | LOW | P1 |
| Edit/delete saved entry | HIGH | LOW | P1 |
| Manual/text entry fallback | MEDIUM | LOW | P1 |
| Weekly/multi-day summary (text) | MEDIUM | LOW–MEDIUM | P1 |
| Periodic weight re-entry + recalculation | HIGH | MEDIUM | P2 |
| Pregnancy/breastfeeding onboarding gate | MEDIUM (safety) | LOW | P2 |
| Dietary-pattern-aware candidate ranking | LOW–MEDIUM | MEDIUM | P2 |
| Personal correction memory | MEDIUM | HIGH | P3 |
| Barcode scanning | LOW (blocked on dataset) | HIGH | P3 |
| Photo-based logging | MEDIUM | HIGH | P3 |
| Adaptive TDEE | MEDIUM | HIGH | P3 |

**Priority key:**
- P1: Recommend for v1 launch (mix of already-scoped + newly identified gaps)
- P2: Should have, add once core loop validated with beta
- P3: Nice to have, defer until post-validation / product-market fit

## Competitor Feature Analysis

| Feature | MyFitnessPal | Cal AI | MacroFactor | Noom | VoxBite Approach |
|---------|--------------|--------|-------------|------|-------------------|
| Primary input | Manual database search, barcode | Photo of meal | Manual/barcode/photo | Manual + coach chat | **Voice-first** (+ text fallback recommended) |
| Source of nutrient truth | Mix of verified DB + user/brand submitted | Pure AI estimate, no verified DB fallback | Verified DB | Verified DB | **USDA FDC, math-computed, no LLM in arithmetic** |
| Composite dish handling | User manually builds recipe from ingredients | Single AI-guessed lump value; degrades on mixed/large-portion meals | User manually builds recipe | User manually builds recipe | **Automatic ingredient decomposition** (differentiator) |
| Correction UX | Manual re-search in database | Manual overwrite, no learning, no verified fallback | Manual edit against verified DB | Manual edit + coach commentary on "red" foods | **3-candidate tap-to-swap + grams stepper** (lower friction) |
| Progress framing | Neutral numbers | Neutral numbers | Deliberately no red numbers/streak-shaming; adaptive TDEE | Color-coded red/yellow/green — criticized for moralizing food | **Neutral, honest-uncertainty framing** ("no data" not fabricated 0) |
| Weight tracking | Periodic log + trend | Not a core feature | Continuous, drives adaptive TDEE | Daily weigh-in (criticized for shame) | **Recommend periodic, user-initiated, non-punitive** (v1.x) |
| Social/coaching layer | Community features | None | None | Human-ish "coach" messaging — criticized as manipulative/shaming | **None** — explicit anti-feature, consistent with "not a medical device" disclaimer |

## Sources

- [Cal AI Review — FeastGood.com](https://feastgood.com/cal-ai-review/) — MEDIUM confidence, independent review
- [Cal AI vs MyFitnessPal 2026 — Welling](https://www.welling.ai/articles/cal-ai-vs-myfitnesspal-2026) — MEDIUM confidence
- [Cal AI Didn't Work for Me — Too Inaccurate — Nutrola](https://nutrola.app/en/blog/cal-ai-didnt-work-too-inaccurate) — MEDIUM confidence, corroborated by multiple independent reviews on structural AI-only-estimate weakness
- [Reporting/correcting incorrect food data — Cronometer forums](https://forums.cronometer.com/discussion/comment/7204) — MEDIUM confidence, official community forum
- [The Dark Psychology of Noom — Medium](https://medium.com/@louise_untrapped/the-dark-psychology-of-noom-50296363c299) — MEDIUM confidence, single-author critique, corroborated by other sources below
- [The Dangers of Noom — Femestella](https://www.femestella.com/noom-reviews-horror-stories-eating-disorders/) — MEDIUM confidence
- [How Noom's Food Color System Works — Noom official support](https://www.noom.com/support/faqs/using-the-app/logging-and-tracking/food-and-water/2025/10/how-nooms-food-color-system-works/) — HIGH confidence (primary source, confirms the mechanic being critiqued)
- [From Tracking to Trapped — National Alliance for Eating Disorders](https://www.allianceforeatingdisorders.com/health-tracking-apps-and-disordered-eating/) — MEDIUM-HIGH confidence, advocacy/clinical org
- [Calorie counting and fitness tracking technology: Associations with eating disorder symptomatology — PubMed](https://pubmed.ncbi.nlm.nih.gov/28214452/) — HIGH confidence, peer-reviewed
- [MacroFactor's Algorithms and Core Philosophy — Stronger by Science](https://www.strongerbyscience.com/macrofactor-algorithms-philosophy/) — HIGH confidence, primary source from the app's own research team
- [MacroFactor Review — GainFrame](https://gainframe.app/blog/macrofactor-review/) — MEDIUM confidence
- [Nutrition Labels Are Inaccurate — Stronger by Science](https://www.strongerbyscience.com/nutrition-labels/) — HIGH confidence, cites primary research on label variance
- [Can you trust calorie counts on food labels? — NBC News](https://www.nbcnews.com/health/health-news/calorie-counts-food-labels-trust-nutrition-scientists-rcna263961) — MEDIUM-HIGH confidence
- [Are Calorie Counts Accurate? — Cleveland Clinic](https://health.clevelandclinic.org/are-calorie-counts-accurate) — HIGH confidence, clinical source
- [Every Calorie Tracker App Feature Explained — Nutrola 2026 Guide](https://nutrola.app/en/blog/every-calorie-tracker-app-feature-explained-complete-encyclopedia-2026) — LOW-MEDIUM confidence, marketing-adjacent but consistent with other sources on standard feature set (weekly view, streaks, macro rings)
- [Voice food-logging app landscape (SpeakMeal, TalkFood, SpeakFit, CalPal, Nutrola)](https://nutrola.app/en/blog/is-there-a-calorie-tracker-that-logs-food-by-voice) — LOW-MEDIUM confidence, confirms voice-first is an emerging but not yet dominant category (validates differentiation angle, not a saturated space)
- Project-internal: `/Users/smatov/GitLab/VoxBite/.planning/PROJECT.md` and `/Users/smatov/GitLab/VoxBite/TECH_SPEC.md` — HIGH confidence, primary source for current scope/gaps analysis

---
*Feature research for: Voice-first nutrition/calorie tracking (VoxBite)*
*Researched: 2026-08-10*
