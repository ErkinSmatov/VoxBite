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

/**
 * Byte ceiling for a voice message (CR-02).
 *
 * MAX_VOICE_SECONDS of Telegram OPUS voice is roughly 16 kbit/s, so 60s is
 * on the order of 120 KB. 1 MB leaves a wide margin for higher-bitrate
 * clients while still making it impossible for a client that lies about
 * `duration` to hand OpenAI a multi-megabyte file to bill us for.
 */
export const MAX_VOICE_BYTES = 1024 * 1024;

/** Wall-clock ceiling on the download itself, so a stalled fetch cannot pin a slot forever. */
export const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Thrown when a voice message's own `duration` field exceeds MAX_VOICE_SECONDS (D-14). */
export class VoiceTooLongError extends Error {
  constructor(durationSeconds: number) {
    super(`Голосовое длиннее ${MAX_VOICE_SECONDS} секунд (получено ${durationSeconds}с)`);
    this.name = 'VoiceTooLongError';
  }
}

/**
 * Thrown when the audio is too large in BYTES (CR-02).
 *
 * `duration` is a client-supplied `sendVoice` parameter, not something
 * Telegram measures, so the free duration cap above can be lied about. This
 * is the cap that actually bounds what OpenAI bills us for, since OpenAI
 * charges by the real audio length regardless of what the client claimed.
 */
export class VoiceTooLargeError extends Error {
  constructor(bytes: number) {
    super(`Голосовое больше ${MAX_VOICE_BYTES} байт (получено ${bytes})`);
    this.name = 'VoiceTooLargeError';
  }
}

/** Thrown when the download exceeds DOWNLOAD_TIMEOUT_MS. */
export class VoiceDownloadTimeoutError extends Error {
  constructor() {
    super(`Скачивание голосового превысило ${DOWNLOAD_TIMEOUT_MS} мс`);
    this.name = 'VoiceDownloadTimeoutError';
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
  getFile(): Promise<{ file_path?: string; file_size?: number }>;
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

  // CR-02: getFile() reports Telegram's own measured size. Reject oversized
  // audio here — still before the download and before any paid call — because
  // the duration cap above trusts a number the sending client chose.
  if (typeof file.file_size === 'number' && file.file_size > MAX_VOICE_BYTES) {
    throw new VoiceTooLargeError(file.file_size);
  }

  // The URL below embeds the bot token — never log it, never include it in
  // an error message, never attach it to an error object.
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new VoiceDownloadTimeoutError();
    }
    // Never re-throw the original error: its message can contain the
    // token-bearing URL.
    throw new Error('Не удалось скачать голосовое сообщение');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Only the numeric status code is surfaced — the URL/token never is.
    throw new Error(`Не удалось скачать голосовое сообщение: HTTP ${response.status}`);
  }

  // Second byte gate: file_size may be absent, and a Content-Length header is
  // only a claim, so the buffered result is checked against the same ceiling.
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_VOICE_BYTES) {
    throw new VoiceTooLargeError(declared);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_VOICE_BYTES) {
    throw new VoiceTooLargeError(arrayBuffer.byteLength);
  }

  return Buffer.from(arrayBuffer); // never written to disk; handed directly to the STT adapter
}
