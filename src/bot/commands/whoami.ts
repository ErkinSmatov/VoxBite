/**
 * `/whoami` — sits behind the allowlist gate (src/bot/middleware/allowlist.ts
 * is the first `bot.use()`), not in front of it. A non-allowlisted user
 * never needs `/whoami`, because their `/start` already printed the
 * `отказ: telegram_id=…` line the owner needs (D-06's real discovery
 * mechanism). This command exists purely for an already-allowlisted owner's
 * own convenience: a quick, copyable reminder of their own numeric ID. No DB
 * access.
 */
import type { Context } from 'grammy';

export async function whoamiHandler(ctx: Context): Promise<void> {
  const id = ctx.from?.id;
  await ctx.reply(
    id !== undefined
      ? `Твой telegram_id: ${id} — впиши его в BETA_ALLOWLIST в файле .env и перезапусти бота.`
      : 'Не удалось определить твой telegram_id из этого сообщения.',
  );
}
