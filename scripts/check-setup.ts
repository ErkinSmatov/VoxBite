/**
 * check-setup.ts
 *
 * Проверяет, что база данных Supabase и ключ OpenAI настроены и доступны.
 * Запускается командой: npm run check-setup
 *
 * Флаги:
 *   --db-only      — проверить только базу данных
 *   --openai-only  — проверить только OpenAI
 *   (без флагов)   — проверить и то, и другое
 *
 * Ничего секретного (пароль от базы, OpenAI-ключ) в вывод не печатается.
 */

import postgres from 'postgres';
import OpenAI from 'openai';
import { loadEnv } from '../src/config/env.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function argvHas(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Prints only host:port from a connection string, never the credentials. */
function maskConnectionTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}`;
  } catch {
    return '(не удалось разобрать адрес подключения)';
  }
}

/** Maps a raw error to a one-line, plain-language remediation for a first-time backend dev. */
function explainError(err: unknown, context: 'db' | 'openai'): string {
  const message = err instanceof Error ? err.message : String(err);

  if (context === 'db') {
    if (/ENOTFOUND|EAI_AGAIN/.test(message)) {
      return (
        'Не удалось найти хост базы данных. Проверь DATABASE_URL в .env — ' +
        'скорее всего там остался плейсхолдер (например [YOUR-PASSWORD] или ' +
        'YOUR-PROJECT-REF), который нужно заменить на реальные значения из ' +
        'Supabase Dashboard.'
      );
    }
    if (/password authentication failed/i.test(message)) {
      return (
        'Неверный пароль от базы данных. Сбрось его в Supabase Dashboard -> ' +
        'Project Settings -> Database -> Reset database password, и обнови ' +
        'DATABASE_URL в .env.'
      );
    }
    if (/self-signed certificate|unable to verify the first certificate/i.test(message)) {
      return (
        'Проблема с шифрованием соединения. Проверь, что DATABASE_URL в .env ' +
        'заканчивается на ?sslmode=require.'
      );
    }
    return `Ошибка подключения к базе данных: ${message}`;
  }

  if (/401/.test(message)) {
    return (
      'OpenAI отклонил ключ (401). Ключ неверный или был отозван — создай ' +
      'новый на https://platform.openai.com/api-keys и обнови OPENAI_API_KEY в .env.'
    );
  }
  if (/429/.test(message) && /insufficient_quota/i.test(message)) {
    return (
      'На аккаунте OpenAI закончился баланс (429 insufficient_quota). ' +
      'Пополни баланс в личном кабинете OpenAI (см. инструкцию в Plan 02).'
    );
  }
  return `Ошибка обращения к OpenAI: ${message}`;
}

async function checkDatabase(databaseUrl: string): Promise<void> {
  const target = maskConnectionTarget(databaseUrl);
  console.log(`\nПроверка базы данных (${target})...`);

  if (!databaseUrl.includes('pooler.supabase.com')) {
    console.log(
      '[warn] Адрес не похож на Supabase pooler (pooler.supabase.com). ' +
        'Убедись, что скопировал строку из вкладки "Session pooler".',
    );
  }
  try {
    const url = new URL(databaseUrl);
    if (url.port === '6543') {
      console.log(
        '[warn] Порт 6543 — это Transaction Pooler, он не поддерживает ' +
          'prepared statements, нужные для drizzle-kit migrate. Используй ' +
          'вкладку "Session pooler" (порт 5432).',
      );
    }
  } catch {
    // already reported via maskConnectionTarget failure path below if invalid
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const versionRows = await sql`select version()`;
    const version = versionRows[0]?.version ?? 'unknown';
    console.log(`Postgres version: ${version}`);

    const extRows =
      await sql`select extname, extversion from pg_extension where extname = 'vector'`;
    const ext = extRows[0];
    if (ext) {
      console.log(`vector extension: enabled (v${ext.extversion})`);
      results.push({ name: 'Database (Supabase Postgres)', ok: true, detail: version });
    } else {
      console.log('vector extension: NOT ENABLED');
      console.log(
        'Как включить: Supabase Dashboard -> Database -> Extensions -> ' +
          'найди "vector" -> включи тумблер.',
      );
      results.push({
        name: 'Database (Supabase Postgres)',
        ok: false,
        detail: 'vector extension not enabled',
      });
    }
  } catch (err) {
    console.log(`[FAIL] ${explainError(err, 'db')}`);
    results.push({ name: 'Database (Supabase Postgres)', ok: false, detail: explainError(err, 'db') });
  } finally {
    await sql.end();
  }
}

async function checkOpenAI(apiKey: string): Promise<void> {
  console.log('\nПроверка OpenAI...');
  const client = new OpenAI({ apiKey });
  try {
    const response = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: 'voxbite setup check',
    });
    const embedding = response.data[0]?.embedding ?? [];
    if (embedding.length !== 1536) {
      throw new Error(`unexpected embedding length: ${embedding.length}`);
    }
    console.log('OpenAI embeddings: OK (1536 dimensions)');
    console.log(
      'Стоимость этого запроса: примерно 4 токена, значительно меньше ' +
        '$0.000001 — проверка практически бесплатна.',
    );
    results.push({ name: 'OpenAI embeddings', ok: true, detail: '1536 dimensions' });
  } catch (err) {
    console.log(`[FAIL] ${explainError(err, 'openai')}`);
    results.push({ name: 'OpenAI embeddings', ok: false, detail: explainError(err, 'openai') });
  }
}

async function main(): Promise<void> {
  const dbOnly = argvHas('--db-only');
  const openaiOnly = argvHas('--openai-only');
  const runDb = !openaiOnly;
  const runOpenAI = !dbOnly;

  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  if (runDb) {
    await checkDatabase(env.DATABASE_URL);
  }
  if (runOpenAI) {
    await checkOpenAI(env.OPENAI_API_KEY);
  }

  console.log('\n--- Итог ---');
  let allOk = true;
  for (const result of results) {
    console.log(`[${result.ok ? 'ok' : 'FAIL'}] ${result.name} — ${result.detail}`);
    if (!result.ok) {
      allOk = false;
    }
  }

  if (allOk) {
    console.log('\nSETUP OK');
    process.exit(0);
  } else {
    console.log('\nНастройка ещё не завершена — исправь пункты, помеченные [FAIL], и запусти проверку снова.');
    process.exit(1);
  }
}

main();
