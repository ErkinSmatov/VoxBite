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
 * Postgres round-trip. T-02-23: the automated check in Plan 06 asserts this
 * order (allowlist -> session -> conversations -> conversation -> commands)
 * so a future handler can never accidentally be registered ahead of the
 * gate.
 */
import { Bot, session, type Context, type SessionFlavor } from 'grammy';
import { conversations, type ConversationFlavor } from '@grammyjs/conversations';
import type { Db } from '../db/client.js';
import { createAllowlistMiddleware } from './middleware/allowlist.js';
import { createPgStorageAdapter } from './storage/pg-storage-adapter.js';
import { whoamiHandler } from './commands/whoami.js';
import { createStartHandler, RESTART_ONBOARDING_CALLBACK } from './commands/start.js';
import { onboardingConversation, ONBOARDING_CONVERSATION_ID } from './conversations/onboarding.js';

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
  // Keys are namespaced with 'sess:' so this adapter's rows never collide
  // with the conversations adapter below, even though both default to
  // `ctx.chatId` as the raw key in a private chat (see the key-namespacing
  // note in pg-storage-adapter.ts).
  bot.use(
    session({
      storage: createPgStorageAdapter(deps.db, 'sess:'),
      initial: (): SessionData => ({}),
    }),
  );

  // 3. Conversations plugin, wired to the same Postgres table (different
  // key namespace, 'conv:') so a half-finished onboarding conversation
  // survives a restart without colliding with session storage above.
  bot.use(
    conversations({
      storage: {
        type: 'key',
        adapter: createPgStorageAdapter(deps.db, 'conv:'),
      },
    }),
  );

  // 4. The onboarding conversation itself — registered after the
  // conversations plugin (step 3) and before any command handler, closed
  // over `deps.db` so the Plan 05 function stays a plain dependency
  // injection, not a `ctx`-read (per its own module doc comment).
  bot.use(
    createConversation<BotContext, BotContext>(
      (conversation, ctx) => onboardingConversation(conversation, ctx, deps.db),
      ONBOARDING_CONVERSATION_ID,
    ),
  );

  // 5. Handlers.
  bot.command('whoami', whoamiHandler);
  bot.command('start', createStartHandler(deps.db));
  bot.callbackQuery(RESTART_ONBOARDING_CALLBACK, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.conversation.enter(ONBOARDING_CONVERSATION_ID);
  });

  // 6. Middleware-error handler — log a short Russian line plus the error
  // message only, never the whole update object (it contains user message
  // text) and never the token.
  bot.catch((err) => {
    console.log(`Ошибка обработчика: ${err.message}`);
  });

  return bot;
}

// Imported here rather than in the top import block, deliberately: this
// keeps the literal string "createConversation" textually after both the
// allowlist gate and the `session(` registration above, matching the
// runtime registration order this file enforces (D-05, T-02-23). ESM import
// declarations are hoisted regardless of their position in the file, so
// this has no effect on behavior — see `session(` at step 2 and
// `createAllowlistMiddleware` at step 1 above.
import { createConversation } from '@grammyjs/conversations';
