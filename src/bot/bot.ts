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
 * order (allowlist -> session -> conversations -> conversation -> commands
 * -> meal handlers) so a future handler can never accidentally be
 * registered ahead of the gate.
 *
 * Security property (T-03-46): every registration in section 5 — including
 * the voice/text/unsupported meal handlers added in Phase 3 — sits behind
 * the section-1 allowlist gate, so a non-allowlisted user's update is
 * dropped before it can ever reach a paid OpenAI call. This comment is the
 * explanation; `bot.wiring.test.ts` is the enforcement.
 */
import { Bot, session, type Context, type SessionFlavor } from 'grammy';
import { conversations, createConversation, type ConversationFlavor } from '@grammyjs/conversations';
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
import { buildMealHandlerDeps } from './pipeline-wiring.js';
import { createTextHandler, createUnsupportedHandler, createVoiceHandler } from './handlers/meal.js';

export interface SessionData {
  // Empty for now — conversations own their own state via the storage
  // adapter passed to conversations({ storage: ... }) below, not ctx.session.
}

export type BotContext = Context & SessionFlavor<SessionData> & ConversationFlavor<Context>;

export interface BotDeps {
  db: Db;
  token: string;
  allowlist: Set<number>;
  /** Resolved from env by src/bot/index.ts — this file still never calls loadEnv(). */
  sttModel: string;
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

  // Phase 3: voice/text meal handlers, registered LAST within section 5 so
  // commands keep winning over the text handler (a message starting with
  // '/' is ignored by createTextHandler, but registration order still
  // matters for grammY's dispatch). Built once at startup — never per
  // update — via buildMealHandlerDeps (src/bot/pipeline-wiring.ts).
  const mealDeps = buildMealHandlerDeps({
    db: deps.db,
    token: deps.token,
    api: bot.api,
    sttModel: deps.sttModel,
  });
  bot.on('message:voice', createVoiceHandler(mealDeps));
  bot.on('message:text', createTextHandler(mealDeps));
  // D-06: audio files, video notes, photos, documents, stickers and videos
  // get a short, free refusal — one registration covering all six types
  // rather than six separate ones.
  bot.on(
    ['message:audio', 'message:video_note', 'message:photo', 'message:document', 'message:sticker', 'message:video'],
    createUnsupportedHandler(),
  );

  // 6. Middleware-error handler — logs a short Russian line describing the
  // error only, never the whole update object (it contains user message text,
  // which is health data here) and never the token, and then tells the user
  // in Russian that the failure was ours (CR-01). See error-handler.ts for
  // the logging invariant.
  bot.catch(createErrorHandler());

  return bot;
}
