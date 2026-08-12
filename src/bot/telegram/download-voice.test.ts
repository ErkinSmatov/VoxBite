import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_VOICE_SECONDS } from '../../adapters/stt/types.js';
import {
  downloadVoice,
  VoiceTooLongError,
  VoiceUnavailableError,
  type VoiceDownloadContext,
} from './download-voice.js';
import { createMessageEditor } from './message-editor.js';

const TOKEN = 'super-secret-bot-token-123';

function makeCtx(duration: number, getFile: () => Promise<{ file_path?: string }>): VoiceDownloadContext {
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
