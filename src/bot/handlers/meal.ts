/**
 * meal — the three Telegram-facing handlers that gate, claim, acknowledge
 * and then fire the voice pipeline: `createVoiceHandler`, `createTextHandler`
 * and `createUnsupportedHandler` (D-06). All three live in one file
 * deliberately — the gate ordering below is shared and must be reviewable in
 * one place, matching `src/bot/commands/start.ts`'s
 * `createXHandler(deps)`-closure-over-deps factory shape.
 *
 * GATE ORDER (this order is the phase's entire spend-control story — do not
 * reorder without re-reading 03-07-PLAN.md's `<threat_model>`):
 *   1. claimUpdate — the FIRST effectful statement. `false` => return
 *      immediately, no reply, no cost (D-10). A Telegram redelivery can never
 *      buy a second transcription.
 *   2. findOnboardedUser — a draft's foreign key would fail later anyway;
 *      checked here so the user gets an actionable Russian reply instead.
 *   3. isDailyCapReached — the runaway guard (D-15).
 *   4. [voice only] downloadVoice — D-14's duration cap already ran inside
 *      this call, before Telegram's file API was even touched.
 *   5. ctx.reply(pipelineCopy.ack) — VOICE-02/D-13, one message whose
 *      message_id the pipeline later edits in place.
 *   6. `void processMeal(...).catch(...)` — fired WITHOUT awaiting. grammY
 *      awaits handlers in its dispatch loop, so awaiting the whole pipeline
 *      here would serialize every user behind one slow analysis and break
 *      D-12 ("three voice messages in a row are all processed"). The local
 *      `.catch` is mandatory: `bot.catch()` cannot see a promise that
 *      outlives this handler (03-RESEARCH.md Pitfall 6). It logs only the
 *      update id and the error kind — never the ctx, never the transcript
 *      (health data, per `src/bot/error-handler.ts`'s invariant).
 *
 * `createUnsupportedHandler` (D-06) is the odd one out: it claims nothing,
 * downloads nothing, and never touches the pipeline — the whole point is
 * that an unsupported message type costs zero, not "costs less."
 */
import type { BotContext } from '../bot.js';
import type { Db } from '../../db/client.js';
import {
  claimUpdate as claimUpdateReal,
  markUpdateStatus as markUpdateStatusReal,
} from '../../application/idempotency.js';
import {
  findOnboardedUser as findOnboardedUserReal,
  isDailyCapReached as isDailyCapReachedReal,
} from '../../application/limits.js';
import { processMeal as processMealReal, type PipelineDeps } from '../../application/voice-pipeline.js';
import {
  downloadVoice as downloadVoiceReal,
  VoiceDownloadTimeoutError,
  VoiceTooLargeError,
  VoiceTooLongError,
} from '../telegram/download-voice.js';
import { pipelineCopy } from '../formatting/pipeline-copy.js';

/** Text meals are bounded the same way a voice's duration is (D-14's text-side twin). */
export const MAX_TEXT_LENGTH = 1000;

export interface MealHandlerDeps {
  db: Db;
  token: string;
  deps: PipelineDeps;
  /** Injectable overrides for tests — default to the real implementations. */
  claimUpdate?: typeof claimUpdateReal;
  markUpdateStatus?: typeof markUpdateStatusReal;
  findOnboardedUser?: typeof findOnboardedUserReal;
  isDailyCapReached?: typeof isDailyCapReachedReal;
  downloadVoice?: typeof downloadVoiceReal;
  processMeal?: typeof processMealReal;
}

function resolveIds(ctx: BotContext): { telegramId: number; chatId: number } | null {
  const telegramId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  if (telegramId === undefined || chatId === undefined) {
    console.error('meal handler: update carries no from.id or chat.id, ignoring');
    return null;
  }
  return { telegramId, chatId };
}

export function createVoiceHandler(d: MealHandlerDeps) {
  const claimUpdate = d.claimUpdate ?? claimUpdateReal;
  const markUpdateStatus = d.markUpdateStatus ?? markUpdateStatusReal;
  const findOnboardedUser = d.findOnboardedUser ?? findOnboardedUserReal;
  const isDailyCapReached = d.isDailyCapReached ?? isDailyCapReachedReal;
  const downloadVoice = d.downloadVoice ?? downloadVoiceReal;
  const processMeal = d.processMeal ?? processMealReal;

  return async (ctx: BotContext): Promise<void> => {
    const ids = resolveIds(ctx);
    if (!ids) return;
    const { telegramId, chatId } = ids;
    const updateId = ctx.update.update_id;

    // 1. Idempotency claim — the first effectful statement (D-10).
    const claimed = await claimUpdate({ db: d.db, updateId, telegramId, chatId, kind: 'voice' });
    if (!claimed) {
      return;
    }

    // 2. Onboarding check.
    const user = await findOnboardedUser(d.db, telegramId);
    if (!user) {
      await ctx.reply(pipelineCopy.notOnboarded);
      await markUpdateStatus(d.db, updateId, 'done');
      return;
    }

    // 3. Runaway guard (D-15).
    if (await isDailyCapReached(d.db, telegramId)) {
      await ctx.reply(pipelineCopy.dailyCapReached);
      await markUpdateStatus(d.db, updateId, 'done');
      return;
    }

    // 4. Download (D-14's cap runs inside this call, before any paid call).
    const voice = ctx.message?.voice;
    let audio: Buffer;
    try {
      audio = await downloadVoice(ctx, d.token);
    } catch (err) {
      if (err instanceof VoiceTooLongError || err instanceof VoiceTooLargeError) {
        // CR-02: a client that lies about `duration` to slip past the free
        // cap lands on VoiceTooLargeError instead. Same refusal to the user —
        // the distinction only matters to us, not to them.
        await ctx.reply(pipelineCopy.tooLong);
      } else if (err instanceof VoiceDownloadTimeoutError) {
        await ctx.reply(pipelineCopy.sttFailed);
      } else {
        await ctx.reply(pipelineCopy.internalError);
      }
      await markUpdateStatus(d.db, updateId, 'failed');
      return;
    }

    // 5. Ack — VOICE-02/D-13, this is the message the pipeline edits in place.
    const ack = await ctx.reply(pipelineCopy.ack);

    // D-07: the diary day is frozen from the message's OWN timestamp, not
    // from when the pipeline happens to run. `message.date` is Unix seconds;
    // a missing/zero value should not block a meal, but must be visible.
    const rawDate = ctx.message?.date ?? 0;
    if (rawDate === 0) {
      console.error(`meal handler: update ${updateId} has no message.date, falling back to receipt time`);
    }
    const receivedAt = rawDate === 0 ? new Date() : new Date(rawDate * 1000);

    // 6. Fire the pipeline WITHOUT awaiting — see module doc comment.
    void processMeal(d.deps, {
      updateId,
      telegramId,
      userId: user.id,
      chatId,
      ackMessageId: ack.message_id,
      input: { kind: 'voice', audio, durationSeconds: voice?.duration ?? 0 },
      receivedAt,
      timezone: user.timezone,
    }).catch((err) => {
      console.error(`meal handler: processMeal rejected for update ${updateId} (${err instanceof Error ? err.message : 'unknown error'})`);
    });
  };
}

export function createTextHandler(d: MealHandlerDeps) {
  const claimUpdate = d.claimUpdate ?? claimUpdateReal;
  const markUpdateStatus = d.markUpdateStatus ?? markUpdateStatusReal;
  const findOnboardedUser = d.findOnboardedUser ?? findOnboardedUserReal;
  const isDailyCapReached = d.isDailyCapReached ?? isDailyCapReachedReal;
  const processMeal = d.processMeal ?? processMealReal;

  return async (ctx: BotContext): Promise<void> => {
    const text = ctx.message?.text;
    if (text === undefined || text.startsWith('/')) {
      // Commands are handled by their own bot.command() registrations —
      // never analysed as a meal.
      return;
    }

    const ids = resolveIds(ctx);
    if (!ids) return;
    const { telegramId, chatId } = ids;
    const updateId = ctx.update.update_id;

    // 1. Idempotency claim.
    const claimed = await claimUpdate({ db: d.db, updateId, telegramId, chatId, kind: 'text' });
    if (!claimed) {
      return;
    }

    // 2. Onboarding check.
    const user = await findOnboardedUser(d.db, telegramId);
    if (!user) {
      await ctx.reply(pipelineCopy.notOnboarded);
      await markUpdateStatus(d.db, updateId, 'done');
      return;
    }

    // 3. Runaway guard.
    if (await isDailyCapReached(d.db, telegramId)) {
      await ctx.reply(pipelineCopy.dailyCapReached);
      await markUpdateStatus(d.db, updateId, 'done');
      return;
    }

    // Bound the text length before it reaches the LLM — the text-side twin
    // of D-14's voice duration cap. Refuse rather than truncate: analysing
    // the first MAX_TEXT_LENGTH characters of a longer description silently
    // drops food the user listed and returns a confidently wrong result.
    if (text.length > MAX_TEXT_LENGTH) {
      await ctx.reply(pipelineCopy.textTooLong);
      await markUpdateStatus(d.db, updateId, 'done');
      return;
    }

    // 4. Ack.
    const ack = await ctx.reply(pipelineCopy.ack);

    // D-07: the diary day is frozen from the message's OWN timestamp, not
    // from when the pipeline happens to run. `message.date` is Unix seconds;
    // a missing/zero value should not block a meal, but must be visible.
    const rawDate = ctx.message?.date ?? 0;
    if (rawDate === 0) {
      console.error(`meal handler: update ${updateId} has no message.date, falling back to receipt time`);
    }
    const receivedAt = rawDate === 0 ? new Date() : new Date(rawDate * 1000);

    // 5. Fire the pipeline WITHOUT awaiting — see module doc comment.
    void processMeal(d.deps, {
      updateId,
      telegramId,
      userId: user.id,
      chatId,
      ackMessageId: ack.message_id,
      input: { kind: 'text', text },
      receivedAt,
      timezone: user.timezone,
    }).catch((err) => {
      console.error(`meal handler: processMeal rejected for update ${updateId} (${err instanceof Error ? err.message : 'unknown error'})`);
    });
  };
}

/**
 * D-06: audio files, video notes, photos, documents and stickers get a
 * short polite refusal and cost NOTHING — no claim, no download, no
 * pipeline. Registered in plan 03-08 for
 * message:audio/video_note/photo/document/sticker/video.
 */
export function createUnsupportedHandler() {
  return async (ctx: BotContext): Promise<void> => {
    await ctx.reply(pipelineCopy.unsupportedMessage);
  };
}
