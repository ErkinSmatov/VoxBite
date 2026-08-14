import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_VOICE_SECONDS } from '../../adapters/stt/types.js';
import {
  downloadVoice,
  MAX_VOICE_BYTES,
  VoiceDownloadTimeoutError,
  VoiceTooLargeError,
  VoiceTooLongError,
  VoiceUnavailableError,
  type VoiceDownloadContext,
} from './download-voice.js';
import { createMessageEditor } from './message-editor.js';

const TOKEN = 'super-secret-bot-token-123';

function makeCtx(
  duration: number,
  getFile: () => Promise<{ file_path?: string; file_size?: number }>,
): VoiceDownloadContext {
  return {
    message: { voice: { duration } },
    getFile,
  };
}

describe('downloadVoice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws VoiceTooLongError for a duration over the cap and never calls getFile', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/file.oga' }));
    const ctx = makeCtx(MAX_VOICE_SECONDS + 1, getFile);

    await expect(downloadVoice(ctx, TOKEN)).rejects.toBeInstanceOf(VoiceTooLongError);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('proceeds for a duration exactly at the cap', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/file.oga' }));
    const ctx = makeCtx(MAX_VOICE_SECONDS, getFile);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 }),
    );

    const result = await downloadVoice(ctx, TOKEN);

    expect(getFile).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(Buffer);
  });

  it('calls getFile once, fetches the constructed URL once, and returns a Buffer with the response bytes', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/file.oga' }));
    const ctx = makeCtx(10, getFile);
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(bytes.buffer, { status: 200 }));

    const result = await downloadVoice(ctx, TOKEN);

    expect(getFile).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`https://api.telegram.org/file/bot${TOKEN}/voice/file.oga`);
    expect(Buffer.compare(result, Buffer.from(bytes))).toBe(0);
  });

  it('throws VoiceUnavailableError when getFile returns no file_path, and no fetch happens', async () => {
    const getFile = vi.fn(async () => ({}));
    const ctx = makeCtx(10, getFile);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));

    await expect(downloadVoice(ctx, TOKEN)).rejects.toBeInstanceOf(VoiceUnavailableError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws an error containing the status code but not the token on a non-ok response', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/file.oga' }));
    const ctx = makeCtx(10, getFile);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

    await expect(downloadVoice(ctx, TOKEN)).rejects.toThrow(/404/);
    try {
      await downloadVoice(ctx, TOKEN);
      expect.unreachable('downloadVoice should have thrown');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(TOKEN);
    }
  });

  it('never includes the token or the full download URL in any thrown error message', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/file.oga' }));
    const ctx = makeCtx(10, getFile);
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    try {
      await downloadVoice(ctx, TOKEN);
      expect.unreachable('downloadVoice should have thrown');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(TOKEN);
      expect(message).not.toContain('api.telegram.org/file/bot');
    }
  });

  it('the VoiceTooLongError message does not contain the token', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/file.oga' }));
    const ctx = makeCtx(MAX_VOICE_SECONDS + 5, getFile);

    try {
      await downloadVoice(ctx, TOKEN);
      expect.unreachable('downloadVoice should have thrown');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      expect(message).not.toContain(TOKEN);
    }
  });
});

describe('createMessageEditor', () => {
  it('editMessage(chat, msg, text) calls api.editMessageText once with exactly those three arguments', async () => {
    const editMessageText = vi.fn(async () => ({}));
    const editor = createMessageEditor({ editMessageText });

    await editor.editMessage(123, 456, 'hello');

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith(123, 456, 'hello');
  });
});

// CR-02 regression guards. `voice.duration` is a client-supplied sendVoice
// parameter, not a Telegram measurement, so the free duration cap can simply
// be lied about. OpenAI bills by the real audio length, so without a byte
// ceiling a 20 MB file declared as `duration: 1` was fully buffered and paid
// for. These tests pin the byte gates and the fetch timeout.
describe('downloadVoice byte and timeout ceilings (CR-02)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an oversized file reported by getFile, and never fetches it', async () => {
    const getFile = vi.fn(async () => ({
      file_path: 'voice/huge.oga',
      file_size: MAX_VOICE_BYTES + 1,
    }));
    // duration lies: claims 1 second while the file is megabytes.
    const ctx = makeCtx(1, getFile);
    const fetchSpy = vi.spyOn(global, 'fetch');

    await expect(downloadVoice(ctx, TOKEN)).rejects.toBeInstanceOf(VoiceTooLargeError);
    expect(getFile).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects when Content-Length exceeds the ceiling even if getFile omitted file_size', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/huge.oga' }));
    const ctx = makeCtx(1, getFile);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]).buffer, {
        status: 200,
        headers: { 'content-length': String(MAX_VOICE_BYTES + 1) },
      }),
    );

    await expect(downloadVoice(ctx, TOKEN)).rejects.toBeInstanceOf(VoiceTooLargeError);
  });

  it('rejects when the buffered body exceeds the ceiling despite an honest-looking header', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/huge.oga' }));
    const ctx = makeCtx(1, getFile);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(MAX_VOICE_BYTES + 1).buffer, { status: 200 }),
    );

    await expect(downloadVoice(ctx, TOKEN)).rejects.toBeInstanceOf(VoiceTooLargeError);
  });

  it('accepts a file exactly at the ceiling', async () => {
    const getFile = vi.fn(async () => ({
      file_path: 'voice/ok.oga',
      file_size: MAX_VOICE_BYTES,
    }));
    const ctx = makeCtx(5, getFile);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array(MAX_VOICE_BYTES).buffer, { status: 200 }),
    );

    const result = await downloadVoice(ctx, TOKEN);
    expect(result.byteLength).toBe(MAX_VOICE_BYTES);
  });

  it('throws VoiceDownloadTimeoutError when the fetch aborts, without leaking the token URL', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/slow.oga' }));
    const ctx = makeCtx(5, getFile);
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      const err = new Error(`aborted while fetching https://api.telegram.org/file/bot${TOKEN}/x`);
      err.name = 'AbortError';
      throw err;
    });

    const caught = await downloadVoice(ctx, TOKEN).catch((e: unknown) => e);
    expect(caught).toBeInstanceOf(VoiceDownloadTimeoutError);
    expect((caught as Error).message).not.toContain(TOKEN);
  });

  it('does not leak the token URL when fetch rejects for any other reason', async () => {
    const getFile = vi.fn(async () => ({ file_path: 'voice/x.oga' }));
    const ctx = makeCtx(5, getFile);
    vi.spyOn(global, 'fetch').mockRejectedValue(
      new Error(`ECONNRESET https://api.telegram.org/file/bot${TOKEN}/x`),
    );

    const caught = await downloadVoice(ctx, TOKEN).catch((e: unknown) => e);
    expect((caught as Error).message).not.toContain(TOKEN);
  });
});
