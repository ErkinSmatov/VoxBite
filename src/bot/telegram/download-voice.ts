/**
 * downloadVoice — fetches a Telegram voice message directly into memory,
 * never touching disk (D-05, TECH_SPEC §10).
 *
 * D-14's whole value is that the duration cap is FREE: `duration` already
 * arrives on the update Telegram sent us, so an accidentally held microphone
 * button (or any voice message over MAX_VOICE_SECONDS) is rejected BEFORE
 * `getFile()` is ever called — costing nothing at all, not merely a cheap
 * transcription. This ordering is the entire point of this file and must
 * never be reordered.
 *
 * The `ctx` parameter is typed structurally (only `message.voice.duration`
 * and `getFile()`), copying `src/bot/telegram/ack.ts`'s approach — this
 * keeps the helper unit-testable with a two-line fake and keeps a real
 * grammY `Context` import out of this file entirely.
 *
 * SECURITY INVARIANT (extends `src/bot/error-handler.ts`'s never-log-the-
 * token/never-log-the-update rule to this file): the constructed download
 * URL embeds the bot token in its path. It must never be logged, never
 * included in a thrown error message, and never attached to an error
 * object. On a non-ok HTTP response only the numeric status code is
 * surfaced.
 */
import { MAX_VOICE_SECONDS } from '../../adapters/stt/types.js';

/** Thrown when a voice message's own `duration` field exceeds MAX_VOICE_SECONDS (D-14). */
export class VoiceTooLongError extends Error {
  constructor(durationSeconds: number) {
    super(`Голосовое длиннее ${MAX_VOICE_SECONDS} секунд (получено ${durationSeconds}с)`);
    this.name = 'VoiceTooLongError';
  }
}

/** Thrown when Telegram's getFile() returns no file_path — file may be inaccessible. */
export class VoiceUnavailableError extends Error {
  constructor() {
    super('Telegram не вернул file_path для голосового сообщения');
    this.name = 'VoiceUnavailableError';
  }
}

export interface VoiceDownloadContext {
  message?: {
    voice?: {
      duration: number;
    };
  };
  getFile(): Promise<{ file_path?: string }>;
}

/**
 * Downloads a Telegram voice message into an in-memory Buffer. Never writes
 * to disk — no `fs` import may ever be added to this file (D-05).
 */
export async function downloadVoice(ctx: VoiceDownloadContext, token: string): Promise<Buffer> {
  const voice = ctx.message?.voice;
  if (!voice) {
    throw new Error('downloadVoice called without a voice message');
  }

  // D-14: check duration BEFORE getFile() and before any paid call. This
  // must remain the very first effectful check in this function.
  if (voice.duration > MAX_VOICE_SECONDS) {
    throw new VoiceTooLongError(voice.duration);
  }

  const file = await ctx.getFile();
  if (!file.file_path) {
    throw new VoiceUnavailableError();
  }

  // The URL below embeds the bot token — never log it, never include it in
  // an error message, never attach it to an error object.
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    // Only the numeric status code is surfaced — the URL/token never is.
    throw new Error(`Не удалось скачать голосовое сообщение: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer); // never written to disk; handed directly to the STT adapter
}
