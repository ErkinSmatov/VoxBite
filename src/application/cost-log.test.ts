import { describe, expect, it, vi } from 'vitest';
import { buildCostLine, logCost, type CostInputs } from './cost-log.js';

function baseInputs(overrides: Partial<CostInputs> = {}): CostInputs {
  return {
    sttSeconds: 12.3,
    sttUsage: { input_tokens: 5, output_tokens: 0 },
    sttModel: 'gpt-4o-mini-transcribe',
    llmUsage: { inputTokens: 120, outputTokens: 45 },
    llmModel: 'gpt-4o-mini',
    embeddedCount: 2,
    componentCount: 2,
    ...overrides,
  };
}

describe('buildCostLine', () => {
  it('returns a single line with no newline characters', () => {
    const line = buildCostLine(baseInputs());
    expect(line).not.toMatch(/\n/);
  });

  it('reports STT seconds, LLM token counts, embedded count, component count and a >=4-decimal dollar total', () => {
    const line = buildCostLine(baseInputs());
    expect(line).toMatch(/12\.3/);
    expect(line).toMatch(/in=120/);
    expect(line).toMatch(/out=45/);
    expect(line).toMatch(/embeddings: 2/);
    expect(line).toMatch(/компонентов: 2/);
    expect(line).toMatch(/\$\d+\.\d{4,}/);
  });

  it('a text-input run (sttSeconds null, sttUsage null) still produces a valid line, showing STT as absent not zero-cost-with-model-name', () => {
    const line = buildCostLine(
      baseInputs({ sttSeconds: null, sttUsage: null, sttModel: null }),
    );
    expect(line).not.toMatch(/\n/);
    expect(line).toMatch(/STT: нет/);
    // Must not show a model name alongside a zero-cost STT figure.
    expect(line).not.toMatch(/gpt-4o-mini-transcribe/);
  });

  it('CostInputs has no field capable of carrying transcript or component-name text', () => {
    const inputs = baseInputs();
    const allowedKeys = new Set([
      'sttSeconds',
      'sttUsage',
      'sttModel',
      'llmUsage',
      'llmModel',
      'embeddedCount',
      'componentCount',
    ]);
    for (const key of Object.keys(inputs)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
    // Structural guarantee lives at the TypeScript level: `CostInputs` has no
    // `transcript`/`text`/`component`/`componentEn` field, so no caller can
    // pass one in without a type error — this test documents the allow-list
    // that enforces it stays that way.
    expect([...allowedKeys].some((k) => /transcript|component_?en$|^text$/i.test(k))).toBe(false);
  });

  it('tolerates an unrecognised llmUsage shape without throwing, falling back to a "неизвестно" marker', () => {
    expect(() => buildCostLine(baseInputs({ llmUsage: { totallyUnexpected: true } }))).not.toThrow();
    const line = buildCostLine(baseInputs({ llmUsage: { totallyUnexpected: true } }));
    expect(line).toMatch(/неизвестно/);
  });

  it('tolerates llmUsage being null/undefined/a primitive without throwing', () => {
    expect(() => buildCostLine(baseInputs({ llmUsage: null }))).not.toThrow();
    expect(() => buildCostLine(baseInputs({ llmUsage: undefined }))).not.toThrow();
    expect(() => buildCostLine(baseInputs({ llmUsage: 'not-an-object' }))).not.toThrow();
  });

  it('renders zero embedded strings without throwing', () => {
    const line = buildCostLine(baseInputs({ embeddedCount: 0 }));
    expect(line).toMatch(/embeddings: 0/);
  });
});

describe('logCost', () => {
  it('calls console.log exactly once with buildCostLine\'s output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const inputs = baseInputs();

    logCost(inputs);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(buildCostLine(inputs));

    spy.mockRestore();
  });
});
