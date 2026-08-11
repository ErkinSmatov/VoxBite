/**
 * Fail-closed closed-beta access gate.
 *
 * D-04: an empty or unset `BETA_ALLOWLIST` allows nobody — the bot is
 * closed by default, never open by default. D-05: this middleware must run
 * before every other middleware and handler, and before any `users` row is
 * written (see registration order in src/bot/bot.ts). D-06: a rejected
 * user is logged to the terminal as `отказ: telegram_id=<id>, @<username>`
 * (the owner's actual ID-discovery mechanism — they copy this ID into
 * `BETA_ALLOWLIST` in `.env` and restart) and receives one polite Russian
 * reply. D-07: this is spend/abuse control for a closed beta, not an
 * authorization system — a plaintext env list changed by restarting the
 * process, not roles or a subscription model.
 *
 * Type-only imports from `grammy` (`Context`, `NextFunction`, `Middleware`)
 * are expected and fine in this file — the zero-grammY-imports rule applies
 * to `src/bot/onboarding/**`, not to bot-transport code like this.
 */
import type { Context, MiddlewareFn, NextFunction } from 'grammy';

/**
 * Parses the raw `BETA_ALLOWLIST` env string into a `Set` of Telegram user
 * IDs. Deliberately never throws — malformed *configuration* input should
 * fail closed (drop the bad entry), not crash the process, and an
 * empty/unset/whitespace-only string returns an empty set (D-04).
 *
 * `env.ts` hands this function the raw, untrimmed string — parsing is this
 * module's job, not env.ts's.
 */
export function parseAllowlist(raw: string | undefined): Set<number> {
  if (!raw || raw.trim() === '') {
    return new Set();
  }

  const ids = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0);

  return new Set(ids);
}

/**
 * The first `bot.use()` registered in src/bot/bot.ts (D-05). Rejects any
 * update whose sender is not in `allowlist` — including updates with no
 * `ctx.from` at all (e.g. a channel post) — without ever calling `next()`,
 * so a rejected update never reaches session storage or any handler.
 *
 * Never logs the allowlist contents, the raw `BETA_ALLOWLIST` string, or
 * the full update object — only the single `отказ:` line below.
 */
export function createAllowlistMiddleware(allowlist: Set<number>): MiddlewareFn<Context> {
  return async (ctx: Context, next: NextFunction) => {
    const id = ctx.from?.id;
    if (id !== undefined && allowlist.has(id)) {
      return next();
    }

    const username = ctx.from?.username ?? '(нет username)';
    console.log(`отказ: telegram_id=${id ?? 'unknown'}, @${username}`);
    await ctx.reply('Бот сейчас в закрытой бете. Попроси доступ у владельца бота.');
    return undefined;
  };
}
