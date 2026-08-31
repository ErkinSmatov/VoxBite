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
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.MINI_APP_BASE_URL;
  delete process.env.BETA_ALLOWLIST;
  delete process.env.STT_MODEL;
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

  it('REQUIRED_ENV_KEYS and OPTIONAL_ENV_KEYS together match exactly the keys declared in .env.example', async () => {
    const { REQUIRED_ENV_KEYS, OPTIONAL_ENV_KEYS } = await import('./env');
    expect(REQUIRED_ENV_KEYS).toEqual([
      'DATABASE_URL',
      'OPENAI_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'MINI_APP_BASE_URL',
    ]);
    expect(OPTIONAL_ENV_KEYS).toEqual(['BETA_ALLOWLIST', 'STT_MODEL']);

    const examplePath = path.resolve(import.meta.dirname, '../../.env.example');
    const exampleContent = readFileSync(examplePath, 'utf8');
    const declaredKeys = [...exampleContent.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(declaredKeys.sort()).toEqual([...REQUIRED_ENV_KEYS, ...OPTIONAL_ENV_KEYS].sort());
  });

  it('loadEnv() caches and returns the same object instance on repeated calls', async () => {
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const first = loadEnv();
    const second = loadEnv();
    expect(first).toBe(second);
  });

  it('loadEnv() throws a named-key, .env.example-referencing error when a required var is missing', async () => {
    clearRequiredEnv();
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    expect(() => loadEnv()).toThrowError(/DATABASE_URL/);
    resetEnvCacheForTests();
    expect(() => loadEnv()).toThrowError(/\.env\.example/);
  });

  it('loadEnv() returns DATABASE_URL and OPENAI_API_KEY as non-empty strings when both are set', async () => {
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const result = loadEnv();
    expect(typeof result.DATABASE_URL).toBe('string');
    expect(result.DATABASE_URL.length).toBeGreaterThan(0);
    expect(typeof result.OPENAI_API_KEY).toBe('string');
    expect(result.OPENAI_API_KEY.length).toBeGreaterThan(0);
  });

  it('loadEnv() throws an error naming TELEGRAM_BOT_TOKEN when the token is unset', async () => {
    clearRequiredEnv();
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    expect(() => loadEnv()).toThrowError(/TELEGRAM_BOT_TOKEN/);
  });

  it('loadEnv() throws an error naming MINI_APP_BASE_URL when it is unset', async () => {
    clearRequiredEnv();
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    expect(() => loadEnv()).toThrowError(/MINI_APP_BASE_URL/);
  });

  it('loadEnv() returns BETA_ALLOWLIST as an empty string when the variable is entirely absent', async () => {
    clearRequiredEnv();
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const result = loadEnv();
    expect(result.BETA_ALLOWLIST).toBe('');
  });

  it('loadEnv() returns BETA_ALLOWLIST as an empty string when the variable is set to an empty string', async () => {
    clearRequiredEnv();
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    process.env.BETA_ALLOWLIST = '';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const result = loadEnv();
    expect(result.BETA_ALLOWLIST).toBe('');
  });

  it('loadEnv() returns STT_MODEL as an empty string when the variable is entirely absent', async () => {
    clearRequiredEnv();
    process.env.DATABASE_URL = 'postgres://example';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:AAExampleTokenText';
    process.env.MINI_APP_BASE_URL = 'https://example.vercel.app';
    const { loadEnv, resetEnvCacheForTests } = await import('./env');
    resetEnvCacheForTests();
    const result = loadEnv();
    expect(result.STT_MODEL).toBe('');
  });
});
