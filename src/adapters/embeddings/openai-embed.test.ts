import { describe, expect, it, vi } from 'vitest';
import { createOpenAIEmbedder, type OpenAILike } from './openai-embed.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './types.js';

function fakeVector(seed: number): number[] {
  return new Array(EMBEDDING_DIMENSIONS).fill(0).map((_, i) => (i === 0 ? seed : 0));
}

function makeFakeClient(
  handler: (input: string[]) => Promise<{ data: { index: number; embedding: number[] }[] }>,
): { client: OpenAILike; calls: string[][]; requests: { model: string; dimensions?: number }[] } {
  const calls: string[][] = [];
  const requests: { model: string; dimensions?: number }[] = [];
  const client: OpenAILike = {
    embeddings: {
      create: async ({ input, model, dimensions }) => {
        calls.push(input);
        requests.push({ model, dimensions });
        return handler(input);
      },
    },
  };
  return { client, calls, requests };
}

describe('createOpenAIEmbedder', () => {
  it('embed([]) returns [] and makes zero API calls', async () => {
    const { client, calls } = makeFakeClient(async () => ({ data: [] }));
    const embedder = createOpenAIEmbedder({ client });
    const result = await embedder.embed([]);
    expect(result).toEqual([]);
    expect(calls.length).toBe(0);
  });

  it('sends the configured model and an explicit dimensions parameter on every call (Matryoshka truncation)', async () => {
    const { client, requests } = makeFakeClient(async (input) => ({
      data: input.map((_, i) => ({ index: i, embedding: fakeVector(i) })),
    }));
    const embedder = createOpenAIEmbedder({ client });
    await embedder.embed(['rice', 'chicken breast']);

    expect(requests.length).toBe(1);
    expect(requests[0]?.model).toBe(EMBEDDING_MODEL);
    expect(requests[0]?.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('batches 250 texts into exactly 3 calls of 100/100/50', async () => {
    const { client, calls } = makeFakeClient(async (input) => ({
      data: input.map((_, i) => ({ index: i, embedding: fakeVector(i) })),
    }));
    const embedder = createOpenAIEmbedder({ client });
    const texts = new Array(250).fill(0).map((_, i) => `food ${i}`);
    const result = await embedder.embed(texts);

    expect(calls.length).toBe(3);
    expect(calls[0]?.length).toBe(100);
    expect(calls[1]?.length).toBe(100);
    expect(calls[2]?.length).toBe(50);
    expect(result.length).toBe(250);
  });

  it('preserves input order even when the fake client returns shuffled index values', async () => {
    const { client } = makeFakeClient(async (input) => ({
      data: input
        .map((_, i) => ({ index: i, embedding: fakeVector(i) }))
        .reverse(), // shuffled order in the response array
    }));
    const embedder = createOpenAIEmbedder({ client });
    const texts = ['apple', 'banana', 'carrot'];
    const result = await embedder.embed(texts);

    expect(result[0]).toEqual(fakeVector(0));
    expect(result[1]).toEqual(fakeVector(1));
    expect(result[2]).toEqual(fakeVector(2));
  });

  it('throws naming expected and actual dimensions on a wrong-length embedding', async () => {
    const { client } = makeFakeClient(async () => ({
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
    }));
    const embedder = createOpenAIEmbedder({ client });
    await expect(embedder.embed(['x'])).rejects.toThrow(/1536/);
    await expect(embedder.embed(['x'])).rejects.toThrow(/3/);
  });

  it('retries a 429 rate_limit_exceeded up to maxRetries and succeeds on a later attempt', async () => {
    let attempts = 0;
    const { client } = makeFakeClient(async (input) => {
      attempts += 1;
      if (attempts < 2) {
        const err = Object.assign(new Error('rate limited'), {
          status: 429,
          code: 'rate_limit_exceeded',
        });
        throw err;
      }
      return { data: input.map((_, i) => ({ index: i, embedding: fakeVector(i) })) };
    });
    const embedder = createOpenAIEmbedder({ client, maxRetries: 3 });
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout);

    const result = await embedder.embed(['a']);
    expect(attempts).toBe(2);
    expect(result.length).toBe(1);
    vi.restoreAllMocks();
  });

  it('does NOT retry insufficient_quota and throws an owner-readable message about topping up the balance', async () => {
    const { client, calls } = makeFakeClient(async () => {
      const err = Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' });
      throw err;
    });
    const embedder = createOpenAIEmbedder({ client, maxRetries: 3 });
    await expect(embedder.embed(['a'])).rejects.toThrow(/баланс/);
    expect(calls.length).toBe(1);
  });

  it('does NOT retry a 401 and throws an owner-readable message about OPENAI_API_KEY', async () => {
    const { client, calls } = makeFakeClient(async () => {
      const err = Object.assign(new Error('unauthorized'), { status: 401 });
      throw err;
    });
    const embedder = createOpenAIEmbedder({ client, maxRetries: 3 });
    await expect(embedder.embed(['a'])).rejects.toThrow(/OPENAI_API_KEY/);
    expect(calls.length).toBe(1);
  });
});
