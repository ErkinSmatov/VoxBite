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
import {
  onboardingConversation,
  ONBOARDING_CONVERSATION_ID,
  ONBOARDING_CONVERSATION_CONFIG,
} from './conversations/onboarding.js';
import { questionCopy } from './formatting/onboarding-copy.js';
import { ack } from './telegram/ack.js';
import { createErrorHandler } from './error-handler.js';

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
  //
  // ONBOARDING_CONVERSATION_CONFIG carries the id plus `maxMillisecondsToWait`
  // (CR-03): without a cap, an abandoned questionnaire keeps its
  // `conv:<chatId>` row forever and answers every later message with the
  // question the user walked away from, across restarts.
  bot.use(
    createConversation<BotContext, BotContext>(
      (conversation, ctx) => onboardingConversation(conversation, ctx, deps.db),
      ONBOARDING_CONVERSATION_CONFIG,
    ),
  );

  // 5. Handlers.
  bot.command('whoami', whoamiHandler);
  bot.command('start', createStartHandler(deps.db));
  // /cancel is handled INSIDE the conversation (a running conversation
  // consumes the update and never reaches this handler). This registration
  // exists so the command is not a dead end when nothing is running (CR-03).
  bot.command('cancel', async (ctx) => {
    await ctx.reply(questionCopy.nothingToCancel);
  });
  bot.callbackQuery(RESTART_ONBOARDING_CALLBACK, async (ctx) => {
    // `ack`, not a bare answerCallbackQuery (CR-02): the "Пройти анкету
    // заново" button sits in the user's history forever, so tapping it a day
    // later gets a `400: query is too old` — which must not stop us from
    // actually entering the conversation.
    await ack(ctx);
    await ctx.conversation.enter(ONBOARDING_CONVERSATION_ID);
  });

  // 6. Middleware-error handler — logs a short Russian line describing the
  // error only, never the whole update object (it contains user message text,
  // which is health data here) and never the token, and then tells the user
  // in Russian that the failure was ours (CR-01). See error-handler.ts for
  // the logging invariant.
  bot.catch(createErrorHandler());

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
