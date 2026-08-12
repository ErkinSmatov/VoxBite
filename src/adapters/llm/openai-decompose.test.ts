import { NoObjectGeneratedError } from 'ai';
import { describe, expect, it } from 'vitest';
import { createOpenAIDecomposer, type GenerateObjectLike } from './openai-decompose.js';
import {
  DECOMPOSITION_MODEL,
  DecompositionFailedError,
  DecompositionSchema,
  MAX_COMPONENTS,
} from './types.js';

function makeNoObjectGeneratedError(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    response: { id: 'resp_1', timestamp: new Date(), modelId: DECOMPOSITION_MODEL },
    usage: {
      inputTokens: 10,
      inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 0,
      outputTokenDetails: { reasoningTokens: 0 },
      totalTokens: 10,
    } as never,
    finishReason: 'content-filter',
  });
}

interface RecordedCall {
  model: string;
  prompt: string;
}

function makeFakeGenerate(
  responses: Array<{ object: { items: unknown[] } } | { error: unknown }>,
): { generate: GenerateObjectLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let callIndex = 0;
  const generate: GenerateObjectLike = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    const response = responses[callIndex];
    callIndex += 1;
    if (!response) {
      throw new Error(`fake generate called more times (${calls.length}) than responses provided`);
    }
    if ('error' in response) {
      throw response.error;
    }
    return { object: response.object as never, usage: { inputTokens: 5, outputTokens: 5 } };
  };
  return { generate, calls };
}

describe('createOpenAIDecomposer', () => {
  it('resolves with items from a well-formed multi-item response and calls generate exactly once (DECOMP-01)', async () => {
    const items = [
      { component: 'баранина', component_en: 'lamb, cooked', grams: 200 },
      { component: 'лук', component_en: 'onion, raw', grams: 50 },
    ];
    const { generate, calls } = makeFakeGenerate([{ object: { items } }]);
    const decomposer = createOpenAIDecomposer({ generate });

    const result = await decomposer.decompose('бешбармак с луком');

    expect(result.decomposition.items).toEqual(items);
    expect(calls.length).toBe(1);
  });

  it('passes the provider usage and the model name through to the caller, so the D-17 cost line can report real token counts', async () => {
    const items = [{ component: 'банан', component_en: 'banana', grams: 120 }];
    const { generate } = makeFakeGenerate([{ object: { items } }]);
    const decomposer = createOpenAIDecomposer({ generate });

    const result = await decomposer.decompose('съел банан');

    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 5 });
    expect(result.model).toBe(DECOMPOSITION_MODEL);
  });

  it('passes usage through from the retry attempt too, not only the first attempt', async () => {
    const items = [{ component: 'рис', component_en: 'rice, cooked', grams: 150 }];
    const { generate } = makeFakeGenerate([
      { error: makeNoObjectGeneratedError() },
      { object: { items } },
    ]);
    const decomposer = createOpenAIDecomposer({ generate });

    const result = await decomposer.decompose('плов');

    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 5 });
    expect(result.model).toBe(DECOMPOSITION_MODEL);
  });

  it('resolves with an empty list and calls generate exactly once — no retry spent (D-08)', async () => {
    const { generate, calls } = makeFakeGenerate([{ object: { items: [] } }]);
    const decomposer = createOpenAIDecomposer({ generate });

    const result = await decomposer.decompose('привет, как дела');

    expect(result.decomposition.items).toEqual([]);
    expect(calls.length).toBe(1);
  });

  it('resolves with exactly one component, unmodified, for a single-ingredient dish (DECOMP-02)', async () => {
    const items = [{ component: 'банан', component_en: 'banana', grams: 120 }];
    const { generate, calls } = makeFakeGenerate([{ object: { items } }]);
    const decomposer = createOpenAIDecomposer({ generate });

    const result = await decomposer.decompose('съел банан');

    expect(result.decomposition.items).toEqual(items);
    expect(calls.length).toBe(1);
  });

  it('retries once on NoObjectGeneratedError, resolves on the second call, and the second call receives the strict prompt (DECOMP-03)', async () => {
    const items = [{ component: 'рис', component_en: 'rice, cooked', grams: 150 }];
    const { generate, calls } = makeFakeGenerate([
      { error: makeNoObjectGeneratedError() },
      { object: { items } },
    ]);
    const decomposer = createOpenAIDecomposer({ generate });

    const result = await decomposer.decompose('плов');

    expect(result.decomposition.items).toEqual(items);
    expect(calls.length).toBe(2);
    expect(calls[0]?.prompt).not.toContain('последняя попытка');
    expect(calls[1]?.prompt).toMatch(/предыдущ.*попытк/is);
  });

  it('throws DecompositionFailedError after exactly two generate calls when both fail with NoObjectGeneratedError', async () => {
    const { generate, calls } = makeFakeGenerate([
      { error: makeNoObjectGeneratedError() },
      { error: makeNoObjectGeneratedError() },
    ]);
    const decomposer = createOpenAIDecomposer({ generate });

    await expect(decomposer.decompose('манты')).rejects.toThrow(DecompositionFailedError);
    expect(calls.length).toBe(2);
  });

  it('DecompositionFailedError message is DECOMPOSITION_FAILED', async () => {
    const { generate } = makeFakeGenerate([
      { error: makeNoObjectGeneratedError() },
      { error: makeNoObjectGeneratedError() },
    ]);
    const decomposer = createOpenAIDecomposer({ generate });

    await expect(decomposer.decompose('манты')).rejects.toThrow('DECOMPOSITION_FAILED');
  });

  it('rethrows a non-NoObjectGeneratedError failure immediately without a second generate call', async () => {
    const { generate, calls } = makeFakeGenerate([{ error: new Error('boom') }]);
    const decomposer = createOpenAIDecomposer({ generate });

    await expect(decomposer.decompose('текст')).rejects.toThrow();
    expect(calls.length).toBe(1);
  });

  it('maps a 401-shaped error to a Russian message containing OPENAI_API_KEY', async () => {
    const authError = Object.assign(new Error('Unauthorized'), { status: 401 });
    const { generate } = makeFakeGenerate([{ error: authError }]);
    const decomposer = createOpenAIDecomposer({ generate });

    await expect(decomposer.decompose('текст')).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('maps an insufficient_quota-shaped error to a Russian message containing баланс', async () => {
    const quotaError = Object.assign(new Error('quota'), { code: 'insufficient_quota' });
    const { generate } = makeFakeGenerate([{ error: quotaError }]);
    const decomposer = createOpenAIDecomposer({ generate });

    await expect(decomposer.decompose('текст')).rejects.toThrow(/баланс/);
  });

  it('passes DECOMPOSITION_MODEL to generate by default', async () => {
    const { generate, calls } = makeFakeGenerate([{ object: { items: [] } }]);
    const decomposer = createOpenAIDecomposer({ generate });

    await decomposer.decompose('текст');

    expect(calls[0]?.model).toBe(DECOMPOSITION_MODEL);
  });

  it('passes an injected model override to generate', async () => {
    const { generate, calls } = makeFakeGenerate([{ object: { items: [] } }]);
    const decomposer = createOpenAIDecomposer({ generate, model: 'gpt-4o' });

    await decomposer.decompose('текст');

    expect(calls[0]?.model).toBe('gpt-4o');
  });

  it('never constructs a real OpenAI provider when generate is injected (no network call possible)', async () => {
    const { generate } = makeFakeGenerate([{ object: { items: [] } }]);
    // No apiKey supplied and no OPENAI_API_KEY read — if this succeeded it would
    // mean the factory tried to build a real client despite the injected fn.
    const decomposer = createOpenAIDecomposer({ generate });
    await expect(decomposer.decompose('текст')).resolves.toBeDefined();
  });

  // Task 1 schema cases, per the plan's instruction to keep them alongside
  // this adapter's tests rather than in a separate schema-only file.
  describe('DecompositionSchema (Task 1 schema cases)', () => {
    it('accepts an empty items list (D-08)', () => {
      expect(() => DecompositionSchema.parse({ items: [] })).not.toThrow();
    });

    it('accepts a well-formed single component', () => {
      expect(() =>
        DecompositionSchema.parse({
          items: [{ component: 'банан', component_en: 'banana', grams: 120 }],
        }),
      ).not.toThrow();
    });

    it('rejects a string grams value', () => {
      expect(() =>
        DecompositionSchema.parse({
          items: [{ component: 'банан', component_en: 'banana', grams: '120' }],
        }),
      ).toThrow();
    });

    it('rejects grams = 0', () => {
      expect(() =>
        DecompositionSchema.parse({
          items: [{ component: 'банан', component_en: 'banana', grams: 0 }],
        }),
      ).toThrow();
    });

    it('rejects negative grams', () => {
      expect(() =>
        DecompositionSchema.parse({
          items: [{ component: 'банан', component_en: 'banana', grams: -5 }],
        }),
      ).toThrow();
    });

    it('rejects grams exceeding MAX_COMPONENT_GRAMS', () => {
      expect(() =>
        DecompositionSchema.parse({
          items: [{ component: 'банан', component_en: 'banana', grams: 2001 }],
        }),
      ).toThrow();
    });

    it('rejects an empty component_en string', () => {
      expect(() =>
        DecompositionSchema.parse({
          items: [{ component: 'банан', component_en: '', grams: 120 }],
        }),
      ).toThrow();
    });

    it('rejects more than MAX_COMPONENTS items', () => {
      const items = new Array(MAX_COMPONENTS + 1).fill(0).map((_, i) => ({
        component: `компонент ${i}`,
        component_en: `component ${i}`,
        grams: 10,
      }));
      expect(() => DecompositionSchema.parse({ items })).toThrow();
    });
  });
});
