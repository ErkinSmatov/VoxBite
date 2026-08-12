import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../application/idempotency.js', () => ({
  findInterruptedUpdates: vi.fn(),
  markInterrupted: vi.fn(),
}));

import { findInterruptedUpdates, markInterrupted } from '../application/idempotency.js';
import { runStartupSweep } from './startup-sweep.js';
import { pipelineCopy } from './formatting/pipeline-copy.js';

const findInterruptedUpdatesMock = vi.mocked(findInterruptedUpdates);
const markInterruptedMock = vi.mocked(markInterrupted);

const fakeDb = { marker: 'fake-db' } as never;

describe('runStartupSweep', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    findInterruptedUpdatesMock.mockReset();
    markInterruptedMock.mockReset();
    markInterruptedMock.mockResolvedValue(undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('no interrupted rows: calls findInterruptedUpdates once, never notifies, never marks a non-empty array, returns a zeroed report', async () => {
    findInterruptedUpdatesMock.mockResolvedValue([]);
    const notify = vi.fn();

    const report = await runStartupSweep({ db: fakeDb, notify });

    expect(findInterruptedUpdatesMock).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(markInterruptedMock).not.toHaveBeenCalled();
    expect(report).toEqual({ found: 0, notified: 0, notifyFailed: 0 });
  });

  it('two interrupted rows: notifies each with its chatId and pipelineCopy.interruptedByRestart, and marks both ids in one call', async () => {
    findInterruptedUpdatesMock.mockResolvedValue([
      { updateId: 1, chatId: 100, telegramId: 1000 },
      { updateId: 2, chatId: 200, telegramId: 2000 },
    ]);
    const notify = vi.fn().mockResolvedValue(undefined);

    const report = await runStartupSweep({ db: fakeDb, notify });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, 100, pipelineCopy.interruptedByRestart);
    expect(notify).toHaveBeenNthCalledWith(2, 200, pipelineCopy.interruptedByRestart);
    expect(markInterruptedMock).toHaveBeenCalledTimes(1);
    expect(markInterruptedMock).toHaveBeenCalledWith(fakeDb, [1, 2]);
    expect(report).toEqual({ found: 2, notified: 2, notifyFailed: 0 });
  });

  it('a notify that rejects for one row: the other row is still notified, markInterrupted still receives BOTH ids, report shows notifyFailed 1', async () => {
    findInterruptedUpdatesMock.mockResolvedValue([
      { updateId: 1, chatId: 100, telegramId: 1000 },
      { updateId: 2, chatId: 200, telegramId: 2000 },
    ]);
    const notify = vi.fn().mockImplementation((chatId: number) => {
      if (chatId === 100) {
        return Promise.reject(new Error('blocked'));
      }
      return Promise.resolve(undefined);
    });

    const report = await runStartupSweep({ db: fakeDb, notify });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(markInterruptedMock).toHaveBeenCalledWith(fakeDb, [1, 2]);
    expect(report).toEqual({ found: 2, notified: 1, notifyFailed: 1 });
  });

  it('findInterruptedUpdates rejecting: runStartupSweep resolves with a zeroed report and logs one line', async () => {
    findInterruptedUpdatesMock.mockRejectedValue(new Error('db unreachable'));
    const notify = vi.fn();

    const report = await runStartupSweep({ db: fakeDb, notify });

    expect(report).toEqual({ found: 0, notified: 0, notifyFailed: 0 });
    expect(notify).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('markInterrupted rejecting: runStartupSweep still resolves', async () => {
    findInterruptedUpdatesMock.mockResolvedValue([{ updateId: 1, chatId: 100, telegramId: 1000 }]);
    markInterruptedMock.mockRejectedValue(new Error('db write failed'));
    const notify = vi.fn().mockResolvedValue(undefined);

    await expect(runStartupSweep({ db: fakeDb, notify })).resolves.toEqual({
      found: 1,
      notified: 1,
      notifyFailed: 0,
    });
  });

  it('never calls processMeal, downloadVoice or any transcription function (source grep)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const source = fs.readFileSync(path.resolve(import.meta.dirname, './startup-sweep.ts'), 'utf8');
    const stripped = source
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n');
    expect(stripped).not.toMatch(/processMeal|downloadVoice|transcribe/);
  });

  it('no log line produced by the module contains a chat id, telegram id or message text', async () => {
    findInterruptedUpdatesMock.mockResolvedValue([{ updateId: 1, chatId: 12345, telegramId: 67890 }]);
    const notify = vi.fn().mockResolvedValue(undefined);

    await runStartupSweep({ db: fakeDb, notify });

    const allCalls = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((c) => String(c[0]));
    for (const line of allCalls) {
      expect(line).not.toContain('12345');
      expect(line).not.toContain('67890');
      expect(line).not.toContain(pipelineCopy.interruptedByRestart);
    }
  });
});
