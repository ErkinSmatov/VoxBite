import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// These tests exercise loadEnv()'s validation logic against a process.env that
// each case controls explicitly. Without this mock, dotenvSafe.config() reads
// the developer's real .env from disk and re-populates the very keys a test
// just deleted — so the "missing key" case only failed correctly on machines
// that happened to have no .env yet. Stubbing the file-loading side keeps these
// tests hermetic and machine-independent.
vi.mock('dotenv-safe', () => ({
  default: { config: () => ({ parsed: {} }) },
}));

const ORIGINAL_ENV = { ...process.env };

function clearRequiredEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.OPENAI_API_KEY;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  const { resetEnvCacheForTests } = await import('./env');
  resetEnvCacheForTests();
});

describe('env.ts', () => {
  it('can be imported without throwing even when no .env file exists on disk', async () => {
    clearRequiredEnv();
    await expect(import('./env')).resolves.toBeTruthy();
  });

  it('REQUIRED_ENV_KEYS matches exactly the keys declared in .env.example', async () => {
    const { REQUIRED_ENV_KEYS } = await import('./env');
    expect(REQUIRED_ENV_KEYS).toEqual(['DATABASE_URL', 'OPENAI_API_KEY']);

    const examplePath = path.resolve(import.meta.dirname, '../../.env.example');
    const exampleContent = readFileSync(examplePath, 'utf8');
    const declaredKeys = [...exampleContent.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(declaredKeys.sort()).toEqual([...REQUIRED_ENV_KEYS].sort());
  });

  it('loadEnv() caches and returns the same object instance on repeated calls', async () => {
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const first = loadEnv();
    const second = loadEnv();
    expect(first).toBe(second);
  });

  it('loadEnv() throws a named-key, .env.example-referencing error when a required var is missing', async () => {
    clearRequiredEnv();
    process.env.OPENAI_API_KEY = 'sk-test';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    expect(() => loadEnv()).toThrowError(/DATABASE_URL/);
    resetEnvCacheForTests();
    expect(() => loadEnv()).toThrowError(/\.env\.example/);
  });

  it('loadEnv() returns DATABASE_URL and OPENAI_API_KEY as non-empty strings when both are set', async () => {
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const result = loadEnv();
    expect(typeof result.DATABASE_URL).toBe('string');
    expect(result.DATABASE_URL.length).toBeGreaterThan(0);
    expect(typeof result.OPENAI_API_KEY).toBe('string');
    expect(result.OPENAI_API_KEY.length).toBeGreaterThan(0);
  });
});
