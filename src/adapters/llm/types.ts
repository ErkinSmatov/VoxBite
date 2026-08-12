/**
 * Hexagonal port for dish decomposition — turns a Russian voice transcript
 * (possibly naming a Kazakh dish) into a list of FDC-findable ingredient
 * components with an English name and a gram estimate for each.
 *
 * This module (`src/adapters/llm/types.ts`) mirrors the shape of
 * `src/adapters/embeddings/types.ts`: exported constants, one Zod schema
 * that IS the TypeScript type, and a single port interface. See
 * `src/domain/fdc-matching/types.ts` for the same defensive doc-comment
 * style applied to a port.
 */
import { z } from 'zod';

/**
 * D-16: single exported constant — the ONLY place the decomposition model
 * name is allowed to appear in this codebase (enforced by a grep gate in
 * this plan's acceptance criteria). `gpt-4o-mini` is the planner's default
 * choice, NOT a locked owner decision (03-RESEARCH.md assumption A1) —
 * swapping it is a one-line edit here. The model MUST support OpenAI's
 * strict structured-output mode (`generateObject` relies on it); do not
 * swap in a model that lacks that support without re-verifying Pitfall 1
 * below still holds.
 */
export const DECOMPOSITION_MODEL = 'gpt-4o-mini';

/**
 * Hard backstop against garbage reaching Postgres — NOT a claim of
 * plausibility. A 1900 g banana passes this bound; catching an implausible
 * (but in-range) estimate is the human's job when reading the D-18 result
 * card, per 03-RESEARCH.md Pitfall 4. Do not conflate "passes Zod" with
 * "is a sane estimate."
 */
export const MAX_COMPONENT_GRAMS = 2000;

/** Same backstop spirit as MAX_COMPONENT_GRAMS, applied to list length. */
export const MAX_COMPONENTS = 15;

const ComponentSchema = z.object({
  /** Russian ingredient name, as the model would name it in speech. */
  component: z.string().min(1),
  /**
   * Plain English ingredient name in the register USDA FoodData Central
   * uses (e.g. "lamb, cooked"), produced by the SAME call — there is no
   * separate translation step (DECOMP-01, TECH_SPEC §5.4). This is the
   * string that gets embedded and matched, so it must never be a
   * transliteration of the dish name.
   */
  component_en: z.string().min(1),
  /**
   * Bounded 0 < g <= MAX_COMPONENT_GRAMS. See MAX_COMPONENT_GRAMS doc
   * comment — this is a backstop, not a plausibility claim.
   */
  grams: z.number().positive().max(MAX_COMPONENT_GRAMS),
});

/**
 * IMPORTANT (03-RESEARCH.md Pitfall 1): never mark a field optional or
 * nullish anywhere in this schema (avoid Zod's optional-field and
 * nullish-field modifiers). OpenAI's strict structured-output mode does
 * not support them — using either produces a `NoObjectGeneratedError` with
 * `finish_reason: 'content-filter'`, which looks like a content-safety
 * rejection but is actually a schema-incompatibility bug. If a field must
 * ever legitimately be absent, mark it nullable instead.
 *
 * `items: []` (an empty list) is VALID and is D-08's normal "no food in the
 * message" answer — it is not a validation failure and must never trigger
 * the DECOMP-03 retry.
 */
export const DecompositionSchema = z.object({
  items: z.array(ComponentSchema).max(MAX_COMPONENTS),
});

export type Decomposition = z.infer<typeof DecompositionSchema>;

/**
 * Thrown when the model produced schema-invalid output TWICE — once on the
 * initial attempt, once on the DECOMP-03 strict retry. Its one meaning: the
 * caller must show `pipelineCopy.decompositionFailed`. A named error class
 * (rather than a magic string thrown as a bare Error) keeps the pipeline's
 * `instanceof` check honest.
 */
export class DecompositionFailedError extends Error {
  constructor() {
    super('DECOMPOSITION_FAILED');
    this.name = 'DecompositionFailedError';
  }
}

export interface DishDecomposer {
  decompose(transcript: string): Promise<Decomposition>;
}

/**
 * `usage` stays `unknown` here deliberately — the AI SDK v7 usage field
 * names (`inputTokens`/`outputTokens`/...) must be narrowed at the call
 * site against the installed `ai` package types, not guessed in this port.
 */
export interface DecompositionResult {
  decomposition: Decomposition;
  usage: unknown;
  model: string;
}
