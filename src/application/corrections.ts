/**
 * corrections — the four persisted-draft mutations behind CORRECT-03..06:
 * `swapCandidate`, `adjustGrams`/`applyTypedGrams`, `removeComponent`,
 * `addComponent`. Plan 09's Telegram handlers only ever dispatch a button
 * tap or a free-text reply into one of these functions; every rule about
 * WHAT is a valid correction lives here, unit-testable without a bot.
 *
 * Two hard rules restated from `src/application/types.ts` (this file is
 * `src/application/`, so both apply): never import `grammy`, and never hold
 * module-level state — every function below takes `db` and reads/writes
 * Postgres, nothing is cached here.
 *
 * RE-READ RULE (04-RESEARCH.md Pattern 1): every operation re-reads the
 * draft from Postgres via `readDraft` before mutating it. A handler must
 * never pass in a component array it cached from a previous render — the
 * process can restart between rendering a keyboard and the tap arriving.
 *
 * ACCEPTED TRADEOFF 1 (this plan's objective, CLAUDE.md-transparent, and
 * matching `draft-store.ts`'s module header): there is no compare-and-swap
 * on gram adjustments. Two fast taps on `+10 г` can both read the same base
 * value and land as a single +10 — visible and self-correcting (the user
 * sees the number and taps again), never a silently duplicated diary row.
 * Confirm/delete get CAS (plan 08) because a duplicate there is invisible.
 *
 * ACCEPTED TRADEOFF 2 (discretion exercised, 04-CONTEXT.md left this open):
 * the gram step is `GRAM_STEP = 10` only — no second step size. A second
 * step would double the button row for a correction the typed-grams path
 * already covers exactly.
 *
 * LOGGING RULE: nothing in this file logs transcript or component text. A
 * failure logs only the draft id and the operation name (the
 * `voice-pipeline.ts` logging invariant) — never the user's typed text,
 * which is health data.
 */
import type { Db } from '../db/client.js';
import { matchIngredient, type FdcRepository } from '../domain/fdc-matching/index.js';
import type { Embedder } from '../adapters/embeddings/types.js';
import { readDraft, updateDraftComponents } from './draft-store.js';
import { isDraftExpired, isWeakMatch, type DraftComponent } from './types.js';

/** CORRECT-04: the fixed step size for the `±` gram buttons. */
export const GRAM_STEP = 10;

/**
 * Grams must never reach 0 or go negative via the `±` buttons — a 0 g
 * component contributes nothing to the total and reads as a bug, not a
 * deliberate correction.
 */
export const MIN_GRAMS = 1;

/** Upper sanity bound — a single component above 5 kg is a typo, not a meal. */
export const MAX_GRAMS = 5000;

/**
 * Length bound for `addComponent`'s free text, enforced BEFORE the paid
 * embedding call (T-04-03). Mirrors `src/bot/handlers/meal.ts`'s
 * `MAX_TEXT_LENGTH` refuse-don't-truncate precedent, sized down because this
 * is one ingredient name, not a whole meal description.
 */
export const MAX_COMPONENT_TEXT_LENGTH = 100;

/**
 * The one discriminated result shape every operation below returns, so a
 * handler can branch without re-reading the draft. Defined once and reused
 * — no per-function result shape.
 */
export type CorrectionResult =
  | { ok: true; components: DraftComponent[] }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'expired'
        | 'out_of_range'
        | 'invalid_grams'
        | 'write_failed'
        | 'text_too_long'
        | 'empty_text'
        | 'match_failed';
    };

/**
 * The single grams parser for BOTH the typed-grams path and the
 * added-component path (04-RESEARCH.md's Don't Hand-Roll entry), so the
 * nonsense-rejection rule cannot diverge between them. Accepts an optional
 * trailing `г`/`Г`/`g`/`G` unit and surrounding whitespace, tolerates a
 * comma decimal separator, then requires a finite, positive value that
 * rounds (via `Math.round` — half rounds up, e.g. 200.5 -> 201; this is the
 * one stated rounding rule, pinned by a test) into `MIN_GRAMS..MAX_GRAMS`.
 * Returns `null` for everything else — never throws, since this is user
 * text and the handler answers with a Russian retry line.
 */
export function parseGrams(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const match = /^(-?\d+(?:[.,]\d+)?)\s*(?:г|Г|g|G)?$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const numeric = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  const rounded = Math.round(numeric);
  if (rounded < MIN_GRAMS || rounded > MAX_GRAMS) {
    return null;
  }

  return rounded;
}

/**
 * Reads and expiry-checks the draft — the first two steps shared by every
 * operation below. Returns the draft or the failure both callers should
 * return verbatim.
 */
async function readActionableDraft(
  db: Db,
  draftId: number,
  userId: number,
  now: Date,
): Promise<{ ok: true; components: DraftComponent[]; status: string } | { ok: false; reason: 'not_found' | 'expired' }> {
  const draft = await readDraft(db, draftId, userId);
  if (!draft) {
    return { ok: false, reason: 'not_found' };
  }
  if (isDraftExpired(draft.status, draft.createdAt, now)) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, components: draft.components, status: draft.status };
}

/**
 * CORRECT-03: swaps `component[componentIndex]`'s matched candidate for
 * `candidates[candidateIndex]`. Bounds-checks both indices against the
 * actual persisted arrays before writing — an out-of-range index (a stale
 * keyboard, a tampered callback_data) writes nothing.
 */
export async function swapCandidate(
  db: Db,
  draftId: number,
  userId: number,
  componentIndex: number,
  candidateIndex: number,
  now: Date = new Date(),
): Promise<CorrectionResult> {
  const draft = await readActionableDraft(db, draftId, userId, now);
  if (!draft.ok) {
    return draft;
  }

  const component = draft.components[componentIndex];
  if (!component) {
    return { ok: false, reason: 'out_of_range' };
  }
  const candidate = component.candidates[candidateIndex];
  if (!candidate) {
    return { ok: false, reason: 'out_of_range' };
  }

  const updated = draft.components.map((c, i) =>
    i === componentIndex
      ? { ...c, chosenFdcId: candidate.fdcId, weakMatch: isWeakMatch(c.candidates) }
      : c,
  );

  const wrote = await updateDraftComponents(db, draftId, userId, updated);
  if (!wrote) {
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, components: updated };
}

/**
 * CORRECT-04: applies `delta` (expected to be `+GRAM_STEP`/`-GRAM_STEP`) to
 * `component[componentIndex].grams`, clamping into `MIN_GRAMS..MAX_GRAMS`
 * rather than rejecting — a tap at the boundary is a visible no-op, not an
 * error message.
 */
export async function adjustGrams(
  db: Db,
  draftId: number,
  userId: number,
  componentIndex: number,
  delta: number,
  now: Date = new Date(),
): Promise<CorrectionResult> {
  const draft = await readActionableDraft(db, draftId, userId, now);
  if (!draft.ok) {
    return draft;
  }

  const component = draft.components[componentIndex];
  if (!component) {
    return { ok: false, reason: 'out_of_range' };
  }

  const clamped = Math.min(MAX_GRAMS, Math.max(MIN_GRAMS, component.grams + delta));
  const updated = draft.components.map((c, i) => (i === componentIndex ? { ...c, grams: clamped } : c));

  const wrote = await updateDraftComponents(db, draftId, userId, updated);
  if (!wrote) {
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, components: updated };
}

/**
 * CORRECT-04: the typed-grams counterpart to `adjustGrams`, called from the
 * Mini App's grams-input form. `parseGrams` runs FIRST — on `null` this
 * returns `invalid_grams` without writing anything, and the Mini App keeps
 * the input open for the user to try again.
 */
export async function applyTypedGrams(
  db: Db,
  draftId: number,
  userId: number,
  componentIndex: number,
  rawText: string,
  now: Date = new Date(),
): Promise<CorrectionResult> {
  const parsed = parseGrams(rawText);
  if (parsed === null) {
    return { ok: false, reason: 'invalid_grams' };
  }

  const draft = await readActionableDraft(db, draftId, userId, now);
  if (!draft.ok) {
    return draft;
  }

  const component = draft.components[componentIndex];
  if (!component) {
    return { ok: false, reason: 'out_of_range' };
  }

  const updated = draft.components.map((c, i) => (i === componentIndex ? { ...c, grams: parsed } : c));

  const wrote = await updateDraftComponents(db, draftId, userId, updated);
  if (!wrote) {
    return { ok: false, reason: 'write_failed' };
  }

  return { ok: true, components: updated };
}

/**
 * CORRECT-05/D-12: removes `components[componentIndex]`. The empty result
 * (removing the last remaining component) is a legitimate first-class
 * state, NOT special-cased into an abandon or an error — the user can add a
 * component back in.
 */
export async function removeComponent(
  db: Db,
  draftId: number,
  userId: number,
  componentIndex: number,
  now: Date = new Date(),
): Promise<CorrectionResult> {
  const draft = await readActionableDraft(db, draftId, userId, now);
  if (!draft.ok) {
    return draft;
  }

  if (componentIndex < 0 || componentIndex >= draft.components.length) {
    return { ok: false, reason: 'out_of_range' };
  }

  const updated = draft.components.filter((_, i) => i !== componentIndex);

  const wrote = await updateDraftComponents(db, draftId, userId, updated);
  if (!wrote) {
    return { ok: false, reason: 'write_failed' };
  }
  return { ok: true, components: updated };
}

/**
 * Splits a trailing grams token off free text, e.g. "сметана 30" ->
 * `{ name: 'сметана', grams: 30 }`; "сметана 30 г" -> same (the trailing
 * token includes the unit, which `parseGrams` already accepts). When no
 * trailing token parses as grams, the whole text is the name and grams
 * default to 100 — a discretionary choice (04-CONTEXT.md), documented here
 * because the caller cannot see it: the user can tune it afterwards with
 * the same `±10 г` controls as any other component.
 */
function splitTrailingGrams(text: string): { name: string; grams: number } {
  const tokens = text.split(/\s+/);
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1]!;
    const parsed = parseGrams(last);
    if (parsed !== null) {
      const name = tokens.slice(0, -1).join(' ');
      if (name !== '') {
        return { name, grams: parsed };
      }
    }
  }
  return { name: text, grams: 100 };
}

/**
 * CORRECT-06: appends a user-typed missing component to the draft, matched
 * through the SAME `matchIngredient` path (and the SAME embedding model)
 * the original decomposition used — never a second matching implementation,
 * never the decomposition LLM, never STT.
 *
 * Order of operations mirrors `meal.ts`'s gate discipline: the length/empty
 * bound runs BEFORE anything paid, so a runaway or hostile input never
 * reaches the embedder.
 *
 * TRANSLATION RISK, stated rather than glossed over: the FDC index is
 * English, but the user's typed text is used verbatim as both `component`
 * (shown to them) and `componentEn` (sent to the embedder) — there is no
 * translation step here. Querying an English-language index with a Russian
 * phrase is a real quality risk. If beta matching of added components
 * proves poor, the fix is a narrow translate-only call added in a later
 * phase, NOT a second matching implementation in this file.
 */
export async function addComponent(
  db: Db,
  draftId: number,
  userId: number,
  rawText: string,
  deps: { embedder: Embedder; repo: FdcRepository },
  now: Date = new Date(),
): Promise<CorrectionResult> {
  const trimmed = rawText.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty_text' };
  }
  if (trimmed.length > MAX_COMPONENT_TEXT_LENGTH) {
    return { ok: false, reason: 'text_too_long' };
  }

  const draft = await readActionableDraft(db, draftId, userId, now);
  if (!draft.ok) {
    return draft;
  }

  const { name, grams } = splitTrailingGrams(trimmed);

  let candidates;
  try {
    const embeddings = await deps.embedder.embed([name]);
    const embedding = embeddings[0];
    if (!embedding) {
      throw new Error('addComponent: embedder returned no vector for a non-empty input');
    }
    candidates = await matchIngredient({ embedding, repo: deps.repo });
  } catch {
    console.error(`corrections: addComponent match failed for draft ${draftId}`);
    return { ok: false, reason: 'match_failed' };
  }

  const newComponent: DraftComponent = {
    component: name,
    componentEn: name,
    grams,
    candidates,
    chosenFdcId: candidates[0]?.fdcId ?? null,
    weakMatch: isWeakMatch(candidates),
  };

  const updated = [...draft.components, newComponent];

  const wrote = await updateDraftComponents(db, draftId, userId, updated);
  if (!wrote) {
    return { ok: false, reason: 'write_failed' };
  }

  return { ok: true, components: updated };
}
