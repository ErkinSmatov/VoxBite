import dotenvSafe from 'dotenv-safe';

/**
 * The environment variables VoxBite requires to run. This list must stay in
 * sync with the `KEY=` lines declared in `.env.example` — the test suite
 * for this module asserts that equality.
 */
export const REQUIRED_ENV_KEYS = [
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'MINI_APP_BASE_URL',
] as const;

export interface AppEnv {
  DATABASE_URL: string;
  OPENAI_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  // Public https base URL of the deployed Mini App (Vercel). Required, not
  // optional: after phase 04.1 there is no chat-based correction UI left, so
  // a bot running without a working Open button cannot let a user correct
  // or save anything at all — failing loudly at startup is correct here.
  MINI_APP_BASE_URL: string;
  BETA_ALLOWLIST: string; // '' is legal and meaningful: nobody is allowed
  /**
   * '' is legal and means "use STT_MODEL from src/adapters/stt/types.ts"
   * (the cheap default). Validation and fallback to the two legal model
   * names live in src/bot/pipeline-wiring.ts, never in this file.
   */
  STT_MODEL: string;
}

/**
 * Env keys that must be declared in `.env.example` (so the owner sees them
 * and knows they exist) but are legal when empty. `BETA_ALLOWLIST` empty
 * means nobody is allowed (D-04, fail-closed) — the required state for the
 * first run described in D-06. `STT_MODEL` empty means "use the code
 * default" (D-03). These keys must never flow into the `missingKeys` check
 * below.
 */
export const OPTIONAL_ENV_KEYS = ['BETA_ALLOWLIST', 'STT_MODEL'] as const;

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
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN as string,
    MINI_APP_BASE_URL: process.env.MINI_APP_BASE_URL as string,
    BETA_ALLOWLIST: process.env.BETA_ALLOWLIST ?? '',
    STT_MODEL: process.env.STT_MODEL ?? '',
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
