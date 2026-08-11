import dotenvSafe from 'dotenv-safe';

/**
 * The environment variables VoxBite requires to run. This list must stay in
 * sync with the `KEY=` lines declared in `.env.example` — the test suite
 * for this module asserts that equality.
 */
export const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'OPENAI_API_KEY'] as const;

export interface AppEnv {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
}

let cachedEnv: AppEnv | undefined;

function buildMissingKeysMessage(missingKeys: string[]): string {
  return (
    `VoxBite не может запуститься: не заданы переменные окружения ` +
    `${missingKeys.join(', ')}.\n\n` +
    `Что делать:\n` +
    `1. Скопируй файл .env.example в .env командой: cp .env.example .env\n` +
    `2. Открой .env и заполни реальными значениями (инструкции указаны в ` +
    `комментариях внутри .env.example).\n\n` +
    `Файл .env добавлен в .gitignore — он никогда не попадёт в git, поэтому ` +
    `в него безопасно вписывать настоящие секреты.`
  );
}

/**
 * Loads and validates the environment. This is the ONLY place in the codebase
 * that reads process.env for required configuration or invokes dotenv-safe —
 * it is deliberately NOT called at module import time, so importing this file
 * (or anything that transitively imports it, e.g. in a test run) never
 * crashes on a machine that has no `.env` file yet.
 *
 * The result is cached after the first successful call.
 */
export function loadEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  try {
    dotenvSafe.config({ example: '.env.example', allowEmptyValues: false });
  } catch {
    // dotenv-safe throws when .env is missing or a variable declared in
    // .env.example is absent/empty in .env. Fall through to the explicit
    // missing-keys check below so the error message stays consistent
    // regardless of which required key(s) triggered the failure.
  }

  const missingKeys = REQUIRED_ENV_KEYS.filter((key) => {
    const value = process.env[key];
    return value === undefined || value === '';
  });

  if (missingKeys.length > 0) {
    throw new Error(buildMissingKeysMessage(missingKeys));
  }

  cachedEnv = {
    DATABASE_URL: process.env.DATABASE_URL as string,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY as string,
  };

  return cachedEnv;
}

/**
 * Test-only helper: clears the cached env so each test case can exercise
 * loadEnv() against a freshly mutated process.env. Do not call this from
 * application code.
 */
export function resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
