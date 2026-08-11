/**
 * `npm run bot` — the long-polling entrypoint. The only file that calls
 * `bot.start()`. Builds deps (env, DB, allowlist), builds the bot via
 * `createBot()` (src/bot/bot.ts owns handler registration, this file owns
 * transport — D-02), and turns the two failure modes the owner will
 * actually hit first into plain-Russian instructions instead of a stack
 * trace:
 *
 * - A second `npm run bot` process running with the same token (409
 *   Conflict) — grammY's polling loop rethrows this from `bot.start()`
 *   rather than routing it through `bot.catch()` (02-RESEARCH.md Pitfall
 *   3), so it is caught here via try/catch, not via `bot.catch()`.
 * - No internet connection (HttpError).
 *
 * grammY error objects can carry request metadata including the token
 * (02-RESEARCH.md threat table) — this file never passes a caught error
 * object whole to `console.error`; only fixed strings and `err.message`
 * are ever printed.
 */
import { GrammyError, HttpError } from 'grammy';
import { loadEnv } from '../config/env.js';
import { closeDb, createDb } from '../db/client.js';
import { parseAllowlist } from './middleware/allowlist.js';
import { createBot } from './bot.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb();
  const allowlist = parseAllowlist(env.BETA_ALLOWLIST);

  console.log(`Список допущенных telegram_id (BETA_ALLOWLIST): ${allowlist.size} шт.`);
  if (allowlist.size === 0) {
    console.log(
      'BETA_ALLOWLIST пуст — это ожидаемо при первом запуске. Пока список ' +
        'пуст, бот не пустит НИКОГО, даже владельца — это правильное ' +
        'поведение "закрыто по умолчанию" (D-04).\n' +
        'Как открыть себе доступ:\n' +
        '1. Оставь бота запущенным (или запусти сейчас).\n' +
        '2. Отправь боту любое сообщение (например /start) со своего Telegram-аккаунта.\n' +
        '3. В этом терминале появится строка вида "отказ: telegram_id=123456789, @username" — скопируй число.\n' +
        '4. Впиши это число в BETA_ALLOWLIST в файле .env, например BETA_ALLOWLIST=123456789\n' +
        '5. Останови бота (Ctrl+C) и запусти снова командой npm run bot.',
    );
  }

  const bot = createBot({ db, token: env.TELEGRAM_BOT_TOKEN, allowlist });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log('\nОстанавливаю бота...');
    await bot.stop();
    await closeDb();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });

  try {
    await bot.start({
      onStart: (info) => {
        console.log(`Бот запущен: @${info.username}. Останови его сочетанием Ctrl+C.`);
      },
    });
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 409) {
      console.log(
        'Похоже, бот уже запущен в другом терминале — закрой его и запусти снова.\n' +
          'Только один процесс может использовать один токен одновременно.',
      );
      await closeDb();
      process.exit(1);
    }
    if (err instanceof GrammyError && err.error_code === 401) {
      console.log('Telegram не принял токен — проверь TELEGRAM_BOT_TOKEN в .env');
      await closeDb();
      process.exit(1);
    }
    if (err instanceof HttpError) {
      console.log(`Не удалось связаться с Telegram — проверь интернет-соединение. (${err.message})`);
      await closeDb();
      process.exit(1);
    }
    await closeDb();
    throw err;
  }
}

// Guard: importing this module (e.g. from a test) must never start polling.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
