import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMealHandlerDeps, resolveSttModel } from './pipeline-wiring.js';
import { STT_COMPARISON_MODEL, STT_MODEL } from '../adapters/stt/types.js';

describe('resolveSttModel', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('returns STT_MODEL and logs nothing for an empty override', () => {
    expect(resolveSttModel('')).toBe(STT_MODEL);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('returns STT_COMPARISON_MODEL when that exact value is passed', () => {
    expect(resolveSttModel(STT_COMPARISON_MODEL)).toBe(STT_COMPARISON_MODEL);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('trims surrounding whitespace and still recognises the value', () => {
    expect(resolveSttModel(`  ${STT_COMPARISON_MODEL}  `)).toBe(STT_COMPARISON_MODEL);
    expect(resolveSttModel('   ')).toBe(STT_MODEL);
  });

  it('falls back to STT_MODEL and logs exactly one Russian warning line naming both accepted values for an unrecognised override', () => {
    const result = resolveSttModel('whisper-9000');
    expect(result).toBe(STT_MODEL);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]?.[0] as string;
    expect(line).toContain('whisper-9000');
    expect(line).toContain(STT_MODEL);
    expect(line).toContain(STT_COMPARISON_MODEL);
  });
});

describe('buildMealHandlerDeps', () => {
  it('returns an object whose deps carries all seven PipelineDeps fields, plus top-level db and token, with no network call and no required env', () => {
    const fakeDb = { marker: 'fake-db' } as never;
    const fakeApi = { editMessageText: vi.fn() };

    const createTranscriber = vi.fn(() => ({ transcribe: vi.fn() }));
    const createDecomposer = vi.fn(() => ({ decompose: vi.fn() }));
    const createEmbedder = vi.fn(() => ({ embed: vi.fn() }));
    const createRepository = vi.fn(() => ({ findNearest: vi.fn() }));
    const createEditor = vi.fn(() => ({ editMessage: vi.fn() }));

    const result = buildMealHandlerDeps({
      db: fakeDb,
      token: 'test-token',
      api: fakeApi,
      sttModel: '',
      factories: {
        createTranscriber: createTranscriber as never,
        createDecomposer: createDecomposer as never,
        createEmbedder: createEmbedder as never,
        createRepository: createRepository as never,
        createEditor: createEditor as never,
      },
    });

    expect(result.db).toBe(fakeDb);
    expect(result.token).toBe('test-token');
    expect(result.deps.db).toBe(fakeDb);
    expect(result.deps.transcriber).toBeDefined();
    expect(result.deps.decomposer).toBeDefined();
    expect(result.deps.embedder).toBeDefined();
    expect(result.deps.repo).toBeDefined();
    expect(result.deps.editor).toBeDefined();
    expect(result.deps.cardRenderer).toBeDefined();

    expect(createTranscriber).toHaveBeenCalledTimes(1);
    expect(createDecomposer).toHaveBeenCalledTimes(1);
    expect(createEmbedder).toHaveBeenCalledTimes(1);
    expect(createRepository).toHaveBeenCalledWith(fakeDb);
    expect(createEditor).toHaveBeenCalledWith(fakeApi);
  });

  it('passes resolveSttModel result into the transcriber factory', () => {
    const fakeDb = { marker: 'fake-db' } as never;
    const fakeApi = { editMessageText: vi.fn() };
    const createTranscriber = vi.fn(() => ({ transcribe: vi.fn() }));

    buildMealHandlerDeps({
      db: fakeDb,
      token: 'test-token',
      api: fakeApi,
      sttModel: STT_COMPARISON_MODEL,
      factories: {
        createTranscriber: createTranscriber as never,
        createDecomposer: (() => ({ decompose: vi.fn() })) as never,
        createEmbedder: (() => ({ embed: vi.fn() })) as never,
        createRepository: (() => ({ findNearest: vi.fn() })) as never,
        createEditor: (() => ({ editMessage: vi.fn() })) as never,
      },
    });

    expect(createTranscriber).toHaveBeenCalledWith({ model: STT_COMPARISON_MODEL });
  });

  it('runs with no OPENAI_API_KEY and no DATABASE_URL set and performs no network call', () => {
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalDbUrl = process.env.DATABASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DATABASE_URL;

    try {
      expect(() =>
        buildMealHandlerDeps({
          db: { marker: 'fake-db' } as never,
          token: 'test-token',
          api: { editMessageText: vi.fn() },
          sttModel: '',
          factories: {
            createTranscriber: (() => ({ transcribe: vi.fn() })) as never,
            createDecomposer: (() => ({ decompose: vi.fn() })) as never,
            createEmbedder: (() => ({ embed: vi.fn() })) as never,
            createRepository: (() => ({ findNearest: vi.fn() })) as never,
            createEditor: (() => ({ editMessage: vi.fn() })) as never,
          },
        }),
      ).not.toThrow();
    } finally {
      if (originalOpenAiKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAiKey;
      if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    }
  });
});
