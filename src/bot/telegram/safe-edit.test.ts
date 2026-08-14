import { describe, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { safeEditMessageReplyMarkup, safeEditMessageText } from './safe-edit.js';

function makeNotModifiedError(): GrammyError {
  return new GrammyError(
    "Call to 'editMessageText' failed!",
    { ok: false, error_code: 400, description: 'Bad Request: message is not modified' },
    'editMessageText',
    { chat_id: 1, message_id: 1, text: 'same text' },
  );
}

function makeMessageToEditNotFoundError(): GrammyError {
  return new GrammyError(
    "Call to 'editMessageText' failed!",
    { ok: false, error_code: 400, description: 'Bad Request: message to edit not found' },
    'editMessageText',
    { chat_id: 1, message_id: 1, text: 'anything' },
  );
}

describe('safeEditMessageText', () => {
  it('resolves and calls editMessageText exactly once when the edit succeeds', async () => {
    const editMessageText = vi.fn(async () => true);
    await safeEditMessageText({ editMessageText }, 'hello', { reply_markup: 'x' });
    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith('hello', { reply_markup: 'x' });
  });

  it('swallows a GrammyError whose description contains "message is not modified"', async () => {
    const editMessageText = vi.fn(async () => {
      throw makeNotModifiedError();
    });
    await expect(safeEditMessageText({ editMessageText }, 'hello')).resolves.toBeUndefined();
  });

  it('rethrows a GrammyError with description "message to edit not found"', async () => {
    const editMessageText = vi.fn(async () => {
      throw makeMessageToEditNotFoundError();
    });
    await expect(safeEditMessageText({ editMessageText }, 'hello')).rejects.toThrow(
      /message to edit not found/,
    );
  });

  it('rethrows a plain Error unchanged, even if it carries the same swallowed text', async () => {
    const editMessageText = vi.fn(async () => {
      throw new Error('message is not modified');
    });
    await expect(safeEditMessageText({ editMessageText }, 'hello')).rejects.toThrow(
      'message is not modified',
    );
  });

  it('rethrows a plain network error unchanged', async () => {
    const editMessageText = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(safeEditMessageText({ editMessageText }, 'hello')).rejects.toThrow(
      'network down',
    );
  });
});

describe('safeEditMessageReplyMarkup', () => {
  it('resolves and calls editMessageReplyMarkup exactly once when the edit succeeds', async () => {
    const editMessageReplyMarkup = vi.fn(async () => true);
    await safeEditMessageReplyMarkup({ editMessageReplyMarkup }, { reply_markup: 'x' });
    expect(editMessageReplyMarkup).toHaveBeenCalledTimes(1);
    expect(editMessageReplyMarkup).toHaveBeenCalledWith({ reply_markup: 'x' });
  });

  it('swallows a GrammyError whose description contains "message is not modified"', async () => {
    const editMessageReplyMarkup = vi.fn(async () => {
      throw makeNotModifiedError();
    });
    await expect(
      safeEditMessageReplyMarkup({ editMessageReplyMarkup }),
    ).resolves.toBeUndefined();
  });

  it('rethrows a GrammyError with description "message to edit not found"', async () => {
    const editMessageReplyMarkup = vi.fn(async () => {
      throw makeMessageToEditNotFoundError();
    });
    await expect(safeEditMessageReplyMarkup({ editMessageReplyMarkup })).rejects.toThrow(
      /message to edit not found/,
    );
  });

  it('rethrows a plain Error unchanged, even if it carries the same swallowed text', async () => {
    const editMessageReplyMarkup = vi.fn(async () => {
      throw new Error('message is not modified');
    });
    await expect(safeEditMessageReplyMarkup({ editMessageReplyMarkup })).rejects.toThrow(
      'message is not modified',
    );
  });
});
