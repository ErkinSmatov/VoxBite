/**
 * parse-fields — pure parse/validate for the three typed numeric onboarding
 * answers (ONBOARD-01), implementing 02-CONTEXT.md's "Numeric field entry"
 * discretion note: user-typed text is expected, possibly-malformed input,
 * not a programming error, so every function here returns a ParseResult
 * instead of throwing (unlike src/domain/nutrition/target-calories.ts,
 * which throws because its inputs are already-validated internal callers).
 *
 * Zero imports from `grammy` or `@grammyjs/*` (D-08) — this module never
 * touches a Telegram ctx, so it is directly unit-testable.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const AGE_MIN = 10;
export const AGE_MAX = 100;

export const HEIGHT_MIN_CM = 100;
export const HEIGHT_MAX_CM = 250;

export const WEIGHT_MIN_KG = 30;
export const WEIGHT_MAX_KG = 300;

/**
 * Normalizes user text into a strict decimal number, or undefined if the
 * text is not a plain decimal. Deliberately stricter than bare Number(),
 * which accepts '', '0x10', '1e3' and 'Infinity' — none of which are valid
 * answers to "how old are you"/"how tall are you"/"how much do you weigh".
 * Accepts an optional single '.' or ',' decimal separator.
 */
function parseStrictDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const normalized = trimmed.replace(',', '.');
  // Plain decimal only: optional leading '-', digits, optional '.' + digits.
  // Rejects '0x10', '1e3', 'Infinity', 'NaN', and multi-decimal strings.
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return undefined;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    return undefined;
  }
  return n;
}

export function parseAge(text: string): ParseResult<number> {
  const n = parseStrictDecimal(text);
  if (n === undefined || !Number.isInteger(n) || n < AGE_MIN || n > AGE_MAX) {
    return {
      ok: false,
      error: `Напиши свой возраст целым числом лет, например 29 (от ${AGE_MIN} до ${AGE_MAX}).`,
    };
  }
  return { ok: true, value: n };
}

export function parseHeight(text: string): ParseResult<number> {
  const n = parseStrictDecimal(text);
  if (n === undefined || !Number.isInteger(n) || n < HEIGHT_MIN_CM || n > HEIGHT_MAX_CM) {
    return {
      ok: false,
      error:
        `Напиши свой рост в сантиметрах целым числом, например 178 ` +
        `(от ${HEIGHT_MIN_CM} до ${HEIGHT_MAX_CM}).`,
    };
  }
  return { ok: true, value: n };
}

export function parseWeight(text: string): ParseResult<number> {
  const trimmed = text.trim();
  const normalized = trimmed.replace(',', '.');
  const decimalMatch = /^-?\d+(\.(\d+))?$/.exec(normalized);
  if (decimalMatch && decimalMatch[2] && decimalMatch[2].length > 1) {
    return {
      ok: false,
      error: `Напиши свой вес в килограммах, например 72.5 (не больше одного знака после точки).`,
    };
  }

  const n = parseStrictDecimal(text);
  if (n === undefined || n < WEIGHT_MIN_KG || n > WEIGHT_MAX_KG) {
    return {
      ok: false,
      error:
        `Напиши свой вес в килограммах, например 72.5 ` +
        `(от ${WEIGHT_MIN_KG} до ${WEIGHT_MAX_KG}).`,
    };
  }
  return { ok: true, value: Math.round(n * 10) / 10 };
}
