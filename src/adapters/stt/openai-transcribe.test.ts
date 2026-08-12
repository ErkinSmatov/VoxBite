import { describe, expect, it, vi } from 'vitest';
import { createOpenAITranscriber, estimateTranscriptionCostUsd, type OpenAITranscribeLike } from './openai-transcribe.js';
import { STT_COMPARISON_MODEL, STT_MODEL } from './types.js';

interface RecordedCall {
  model: string;
  prompt?: string;
}

function makeFakeTranscribeClient(
  handler: (args: { model: string; prompt?: string }) => Promise<{ text: string; usage?: unknown }>,
): { client: OpenAITranscribeLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: OpenAITranscribeLike = {
    audio: {
      transcriptions: {
        create: async ({ model, prompt }) => {
          calls.push({ model, prompt });
          return handler({ model, prompt });
        },
      },
    },
  };
  return { client, calls };
}

describe('createOpenAITranscriber', () => {
  it('transcribe(buffer) calls create exactly once on success, with model equal to STT_MODEL by default', async () => {
    const { client, calls } = makeFakeTranscribeClient(async () => ({ text: 'бешбармак с картошкой' }));
    const transcriber = createOpenAITranscriber({ client });

    const result = await transcriber.transcribe(Buffer.from('fake-audio'));

    expect(calls.length).toBe(1);
    expect(calls[0]?.model).toBe(STT_MODEL);
    expect(result.text).toBe('бешбармак с картошкой');
  });

  it('transcribe(buffer, { prompt }) passes the prompt through; with no opts, prompt is undefined', async () => {
    const { client, calls } = makeFakeTranscribeClient(async () => ({ text: 'ok' }));
    const transcriber = createOpenAITranscriber({ client });

    await transcriber.transcribe(Buffer.from('a'), { prompt: 'бешбармак' });
    await transcriber.transcribe(Buffer.from('b'));

    expect(calls[0]?.prompt).toBe('бешбармак');
    expect(calls[1]?.prompt).toBeUndefined();
  });

  it('createOpenAITranscriber({ client, model: gpt-4o-transcribe }) sends the comparison model', async () => {
    const { client, calls } = makeFakeTranscribeClient(async () => ({ text: 'ok' }));
    const transcriber = createOpenAITranscriber({ client, model: STT_COMPARISON_MODEL });

    await transcriber.transcribe(Buffer.from('a'));

    expect(calls[0]?.model).toBe(STT_COMPARISON_MODEL);
  });

  it('retries a 429 and then succeeds; total create() calls = 2', async () => {
    let attempts = 0;
    const { client, calls } = makeFakeTranscribeClient(async () => {
      attempts += 1;
      if (attempts < 2) {
        const err = Object.assign(new Error('rate limited'), { status: 429 });
        throw err;
      }
      return { text: 'ok' };
    });
    const transcriber = createOpenAITranscriber({ client, maxRetries: 3 });
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    const result = await transcriber.transcribe(Buffer.from('a'));

    expect(calls.length).toBe(2);
    expect(result.text).toBe('ok');
    vi.restoreAllMocks();
  });

  it('retries a 500 error', async () => {
    let attempts = 0;
    const { client, calls } = makeFakeTranscribeClient(async () => {
      attempts += 1;
      if (attempts < 2) {
        const err = Object.assign(new Error('server error'), { status: 500 });
        throw err;
      }
      return { text: 'ok' };
    });
    const transcriber = createOpenAITranscriber({ client, maxRetries: 3 });
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    const result = await transcriber.transcribe(Buffer.from('a'));

    expect(calls.length).toBe(2);
    expect(result.text).toBe('ok');
    vi.restoreAllMocks();
  });

  it('does NOT retry insufficient_quota and throws an owner-readable message about the balance', async () => {
    const { client, calls } = makeFakeTranscribeClient(async () => {
      const err = Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' });
      throw err;
    });
    const transcriber = createOpenAITranscriber({ client, maxRetries: 3 });

    await expect(transcriber.transcribe(Buffer.from('a'))).rejects.toThrow(/баланс/);
    expect(calls.length).toBe(1);
  });

  it('does NOT retry a 401 and throws an owner-readable message about OPENAI_API_KEY', async () => {
    const { client, calls } = makeFakeTranscribeClient(async () => {
      const err = Object.assign(new Error('unauthorized'), { status: 401 });
      throw err;
    });
    const transcriber = createOpenAITranscriber({ client, maxRetries: 3 });

    await expect(transcriber.transcribe(Buffer.from('a'))).rejects.toThrow(/OPENAI_API_KEY/);
    expect(calls.length).toBe(1);
  });

  it('returns { text, model, usage } where model is the model actually used', async () => {
    const { client } = makeFakeTranscribeClient(async () => ({ text: 'ok', usage: { input_tokens: 5 } }));
    const transcriber = createOpenAITranscriber({ client, model: STT_COMPARISON_MODEL });

    const result = await transcriber.transcribe(Buffer.from('a'));

    expect(result).toEqual({ text: 'ok', model: STT_COMPARISON_MODEL, usage: { input_tokens: 5 } });
  });

  it('estimateTranscriptionCostUsd(60, STT_MODEL) is > 0 and roughly half of the comparison model', () => {
    const miniCost = estimateTranscriptionCostUsd(60, STT_MODEL);
    const fullCost = estimateTranscriptionCostUsd(60, STT_COMPARISON_MODEL);

    expect(miniCost).toBeGreaterThan(0);
    expect(miniCost).toBeCloseTo(fullCost / 2, 5);
  });
});
