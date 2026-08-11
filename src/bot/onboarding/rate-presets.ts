/**
 * rate-presets — the only selectable desired weight-change rates
 * (ONBOARD-02: never faster than 1 kg/month). Three independent layers
 * enforce this product-safety constraint so it cannot drift or be bypassed:
 *   1. UI layer (this file): a value above MAX_RATE_KG_PER_MONTH is not
 *      representable — the button never exists.
 *   2. Domain layer: calculateTargetCalories clamps to MAX_RATE_KG_PER_MONTH
 *      even if a value above it somehow arrives.
 *   3. Database layer: the users_desired_rate_check constraint rejects any
 *      row above 1 kg/month.
 *
 * rate-presets.test.ts asserts the top preset equals MAX_RATE_KG_PER_MONTH
 * so layers 1 and 2 cannot silently drift apart.
 */

// Note: the top preset (1) is a literal, not a reference to
// MAX_RATE_KG_PER_MONTH — rate-presets.test.ts asserts they are equal so a
// future change to the domain cap surfaces here as a failing test rather
// than a silent runtime binding.
export const RATE_PRESETS_KG_PER_MONTH = [0.25, 0.5, 0.75, 1] as const;

/**
 * Same allowlist discipline as decodeOption: strips the `rate:` prefix, then
 * returns the matching member of RATE_PRESETS_KG_PER_MONTH or undefined.
 * Never parses an arbitrary float — a forged 'rate:2' or 'rate:1.0001' must
 * not decode to a usable number.
 */
export function decodeRate(callbackData: string | undefined): number | undefined {
  if (!callbackData || !callbackData.startsWith('rate:')) {
    return undefined;
  }
  const raw = callbackData.slice('rate:'.length);
  return RATE_PRESETS_KG_PER_MONTH.find((preset) => String(preset) === raw);
}
