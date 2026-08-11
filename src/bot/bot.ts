/**
 * Composition root — the only file that knows the middleware registration
 * order. Builds and returns a configured but UNSTARTED `Bot`; never calls
 * `bot.start()`, `loadEnv()`, or `createDb()` itself. Everything arrives via
 * `deps`, which is what keeps this file usable from both the polling
 * entrypoint (src/bot/index.ts) and a future webhook entrypoint without
 * changing a single handler (D-02) — the webhook seam is this file boundary,
 * not an env var.
 *
 * Registration order below is load-bearing (D-05): the allowlist gate runs
 * before session storage, before the conversations plugin, and before any
 * handler — so a rejected update never causes a session read/write or a
 * Postgres round-trip.
 *
 * Plan 06 adds `bot.command('start', ...)` and the onboarding
 * `createConversation(...)` registration to this same file. Until then, an
 * allowlisted `/start` intentionally gets no reply — this is expected, not a
 * bug.
 */
import { Bot, session, type Context, type SessionFlavor } from 'grammy';
import { conversations, type ConversationFlavor } from '@grammyjs/conversations';
import type { Db } from '../db/client.js';
import { createAllowlistMiddleware } from './middleware/allowlist.js';
import { createPgStorageAdapter } from './storage/pg-storage-adapter.js';
import { whoamiHandler } from './commands/whoami.js';

export interface SessionData {
  // Empty for now — conversations own their own state via the storage
  // adapter passed to conversations({ storage: ... }) below, not ctx.session.
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;

export interface BotDeps {
  db: Db;
  token: string;
  allowlist: Set<number>;
}

export function createBot(deps: BotDeps): Bot<BotContext> {
  const bot = new Bot<BotContext>(deps.token);

  // 1. Allowlist gate — first, before anything else (D-05).
  bot.use(createAllowlistMiddleware(deps.allowlist));

  // 2. Session storage, backed by bot_sessions (never process memory).
  bot.use(
    session({
      storage: createPgStorageAdapter(deps.db),
      initial: (): SessionData => ({}),
    }),
  );

  // 3. Conversations plugin, wired to the same Postgres storage so a
  // half-finished onboarding conversation survives a restart.
  bot.use(
    conversations({
      storage: {
        type: 'key',
        adapter: createPgStorageAdapter(deps.db),
      },
    }),
  );

  // 4. Handlers.
  bot.command('whoami', whoamiHandler);

  // 5. Middleware-error handler — log a short Russian line plus the error
  // message only, never the whole update object (it contains user message
  // text) and never the token.
  bot.catch((err) => {
    console.log(`Ошибка обработчика: ${err.message}`);
  });

  return bot;
}
