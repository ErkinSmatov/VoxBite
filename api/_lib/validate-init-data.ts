/**
 * validate-init-data — the Mini App API's auth boundary (04.1-RESEARCH.md
 * Pattern 1). On the web there is no `ctx.from.id` grammY has already
 * verified came from Telegram — every single `/api/*` request must prove
 * for itself, via Telegram's documented HMAC-SHA256-over-bot-token
 * algorithm, that Telegram signed the caller's identity before anything
 * downstream trusts `user.id`. Getting this wrong is a silent
 * authentication bypass, not a visible failure.
 *
 * Real exported API of the installed `@tma.js/init-data-node@2.0.8`
 * (confirmed from `node_modules/@tma.js/init-data-node/dist/entries/node.d.ts`,
 * not from memory, per 04.1-RESEARCH.md's [ASSUMED] flag on this package):
 *   - `validate(value: string | URLSearchParams, token: string, options?: { expiresIn?: number; tokenHashed?: boolean }): void`
 *     Throws one of `SignatureMissingError | SignatureInvalidError |
 *     AuthDateInvalidError | ExpiredError` (all ordinary `Error` subclasses,
 *     from the `error-kid` package) on any failure. `expiresIn` defaults to
 *     86400 (1 day) when omitted — MUST be passed explicitly, or a captured
 *     `initData` string stays replayable for a full day (Pitfall 2).
 *   - `parse(value: string | URLSearchParams)` returns the parsed init-data
 *     object (`{ user?: { id: number; first_name: string; ... }, auth_date,
 *     hash, ... }`), never throwing on its own — call it only AFTER
 *     `validate()` has already thrown-or-not.
 *   - `sign(data, key, authDate, options?)` (used by this file's own test to
 *     build a genuinely valid signature, in place of hand-rolling
 *     `node:crypto` HMAC).
 *
 * Both the HMAC signature check and the `auth_date` freshness check are
 * mandatory (04.1-RESEARCH.md Pitfall 2) — validating the signature alone
 * leaves a captured `initData` string replayable forever.
 */
import { validate, parse } from '@tma.js/init-data-node';

/** Telegram's own docs recommend an expiry check; 1h is a reasonable v1 bound. */
export const MAX_AUTH_AGE_SECONDS = 3600;

export function validateAndParse(rawInitData: string, botToken: string) {
  validate(rawInitData, botToken, { expiresIn: MAX_AUTH_AGE_SECONDS });
  return parse(rawInitData);
}
