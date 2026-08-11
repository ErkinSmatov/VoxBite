/**
 * verify-schema.ts
 *
 * Проверяет, что схема БД в живой базе Supabase соответствует тому, что
 * должно быть после применения миграций. Проверка идёт "снаружи" — прямыми
 * запросами к системным таблицам Postgres (information_schema, pg_catalog),
 * а не чтением файлов TypeScript. Это единственный способ убедиться, что
 * реальная база, а не только код, находится в правильном состоянии.
 *
 * Запускается командой: npm run verify-schema
 * Флаг --json печатает тот же результат в виде JSON (полезно для скриптов).
 *
 * Пояснения для тех, кто впервые работает с бэкендом:
 * - "миграция" — это файл с SQL-командами (CREATE TABLE, ALTER TABLE и т.п.),
 *   который меняет структуру базы данных. Миграции применяются по порядку и
 *   каждая применённая миграция один раз записывается в служебную таблицу
 *   `drizzle.__drizzle_migrations`, чтобы drizzle-kit знал, что уже сделано.
 * - "RLS" (Row Level Security) — встроенный в Postgres механизм, который
 *   решает, кто может читать/писать строки таблицы. Supabase автоматически
 *   публикует каждую таблицу схемы `public` через свой веб-API (PostgREST),
 *   доступный любому, кто знает публичный "anon"-ключ проекта. Если RLS
 *   включён и для таблицы не создано ни одной политики (policy), API отдаёт
 *   пустой результат — это и есть "запретить всё по умолчанию". Подключение
 *   самого бота использует привилегированную роль `postgres` (с флагом
 *   BYPASSRLS), поэтому для него RLS ничего не меняет.
 *
 * Ничего секретного (пароль от базы) в вывод не печатается — только
 * хост и порт.
 */

import postgres from 'postgres';
import { loadEnv } from '../src/config/env.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  remediation?: string;
}

const results: CheckResult[] = [];

function argvHas(flag: string): boolean {
  return process.argv.includes(flag);
}

function maskConnectionTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}`;
  } catch {
    return '(не удалось разобрать адрес подключения)';
  }
}

function record(name: string, ok: boolean, detail: string, remediation?: string): void {
  results.push({ name, ok, detail, remediation });
  const label = ok ? '[ok]' : '[FAIL]';
  console.log(`${label} ${name} — ${detail}`);
}

const REQUIRED_TABLES = ['users', 'diary', 'fdc_foods'] as const;

async function checkTablesExist(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ${sql([...REQUIRED_TABLES])}
  `;
  const found = new Set(rows.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !found.has(t));
  if (missing.length === 0) {
    record(
      'Таблицы существуют',
      true,
      `users, diary, fdc_foods — все три таблицы найдены в схеме public`,
    );
  } else {
    record(
      'Таблицы существуют',
      false,
      `не найдены: ${missing.join(', ')}`,
      'Запусти `npm run db:migrate`, чтобы применить миграции из папки drizzle/',
    );
  }
}

async function checkMigrationsJournal(sql: postgres.Sql): Promise<void> {
  try {
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from drizzle.__drizzle_migrations
    `;
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) {
      record(
        'Журнал миграций (drizzle.__drizzle_migrations)',
        true,
        `${count} применённых миграций записано — значит схема была создана через drizzle-kit migrate, а не вручную или через push`,
      );
    } else {
      record(
        'Журнал миграций (drizzle.__drizzle_migrations)',
        false,
        'таблица журнала есть, но пустая',
        'Запусти `npm run db:migrate`',
      );
    }
  } catch (err) {
    record(
      'Журнал миграций (drizzle.__drizzle_migrations)',
      false,
      `таблица журнала не найдена: ${err instanceof Error ? err.message : String(err)}`,
      'Запусти `npm run db:migrate`, чтобы применить миграции из папки drizzle/',
    );
  }
}

async function checkVectorColumn(sql: postgres.Sql): Promise<void> {
  const colRows = await sql<{ udt_name: string }[]>`
    select udt_name from information_schema.columns
    where table_schema = 'public' and table_name = 'fdc_foods' and column_name = 'embedding'
  `;
  const udtName = colRows[0]?.udt_name;
  if (udtName !== 'vector') {
    record(
      'Тип колонки fdc_foods.embedding',
      false,
      `ожидался тип vector, получен: ${udtName ?? '(колонка не найдена)'}`,
      'Проверь миграцию init_schema — колонка embedding должна быть объявлена как vector(1536)',
    );
    return;
  }

  const dimRows = await sql<{ atttypmod: number }[]>`
    select atttypmod from pg_attribute
    where attrelid = 'public.fdc_foods'::regclass and attname = 'embedding'
  `;
  const dims = dimRows[0]?.atttypmod;
  if (dims === 1536) {
    record(
      'Размерность fdc_foods.embedding',
      true,
      '1536 измерений — столько чисел мы просим у модели эмбеддингов text-embedding-3-large ' +
        'через параметр dimensions (усечение Matryoshka, родной размер модели 3072)',
    );
  } else {
    record(
      'Размерность fdc_foods.embedding',
      false,
      `ожидалось 1536, получено: ${dims ?? 'неизвестно'}`,
      'Проверь миграцию init_schema — vector(\'embedding\', { dimensions: 1536 })',
    );
  }
}

interface NullabilityRow {
  column_name: string;
  is_nullable: 'YES' | 'NO';
}

async function checkNullability(sql: postgres.Sql): Promise<void> {
  const rows = await sql<NullabilityRow[]>`
    select column_name, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'fdc_foods'
      and column_name in ('sugar_g','kcal','protein_g','fat_g','carbs_g','embedding','description','source')
  `;
  const byName = new Map(rows.map((r) => [r.column_name, r.is_nullable]));

  const mustBeNullable = ['sugar_g', 'kcal', 'protein_g', 'fat_g', 'carbs_g'];
  const nullableOk = mustBeNullable.every((c) => byName.get(c) === 'YES');
  if (nullableOk) {
    record(
      'fdc_foods.sugar_g и другие макросы допускают NULL',
      true,
      'sugar_g остаётся NULL, когда в USDA нет данных о сахаре — это отличается от "0 г сахара" (TECH_SPEC §5.8: "нет данных" не равно нулю)',
    );
  } else {
    const bad = mustBeNullable.filter((c) => byName.get(c) !== 'YES');
    record(
      'fdc_foods.sugar_g и другие макросы допускают NULL',
      false,
      `эти колонки должны допускать NULL, но не допускают: ${bad.join(', ')}`,
      'Проверь миграцию init_schema — эти колонки не должны иметь NOT NULL',
    );
  }

  const mustBeNotNull = ['embedding', 'description', 'source'];
  const notNullOk = mustBeNotNull.every((c) => byName.get(c) === 'NO');
  if (notNullOk) {
    record(
      'fdc_foods.embedding/description/source обязательны (NOT NULL)',
      true,
      'ни один индексированный продукт не может остаться без вектора, описания или источника',
    );
  } else {
    const bad = mustBeNotNull.filter((c) => byName.get(c) !== 'NO');
    record(
      'fdc_foods.embedding/description/source обязательны (NOT NULL)',
      false,
      `эти колонки должны быть NOT NULL: ${bad.join(', ')}`,
      'Проверь миграцию init_schema',
    );
  }
}

async function checkHnswIndex(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ indexdef: string }[]>`
    select indexdef from pg_indexes where tablename = 'fdc_foods'
  `;
  const found = rows.some(
    (r) => /hnsw/i.test(r.indexdef) && /vector_cosine_ops/i.test(r.indexdef),
  );
  if (found) {
    record(
      'HNSW-индекс на fdc_foods.embedding',
      true,
      'индекс использует hnsw + vector_cosine_ops — это то, что делает поиск похожих продуктов быстрым',
    );
  } else {
    record(
      'HNSW-индекс на fdc_foods.embedding',
      false,
      'индекс с hnsw + vector_cosine_ops не найден',
      'Проверь миграцию init_schema — должен быть CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)',
    );
  }
}

async function checkUsersConstraints(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ conname: string; consrc: string }[]>`
    select conname, pg_get_constraintdef(oid) as consrc
    from pg_constraint
    where conrelid = 'public.users'::regclass and contype = 'c'
  `;
  const defs = rows.map((r) => r.consrc).join('\n');
  const checks: Array<[string, RegExp]> = [
    ['sex (male/female)', /'male'/],
    ['activity_level (5 уровней)', /'minimal'/],
    ['goal (gain/loss/maintain)', /'gain'/],
    ['desired_rate_kg_per_month <= 1', /desired_rate_kg_per_month/],
  ];
  const missing = checks.filter(([, re]) => !re.test(defs)).map(([name]) => name);
  if (missing.length === 0) {
    record(
      'CHECK-ограничения на users',
      true,
      `${rows.length} ограничений найдено, включая допустимые значения sex/activity_level/goal и потолок темпа набора/снижения веса (1 кг/месяц)`,
    );
  } else {
    record(
      'CHECK-ограничения на users',
      false,
      `не найдены ограничения для: ${missing.join(', ')}`,
      'Проверь миграцию init_schema — таблица users должна иметь CHECK-constraints',
    );
  }
}

async function checkRls(sql: postgres.Sql): Promise<void> {
  const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    where relname in ${sql([...REQUIRED_TABLES])} and relnamespace = 'public'::regnamespace
  `;
  const byName = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
  const notEnabled = REQUIRED_TABLES.filter((t) => byName.get(t) !== true);
  if (notEnabled.length === 0) {
    record(
      'Row Level Security (RLS) включён',
      true,
      'users, diary, fdc_foods защищены от чтения через публичный Supabase API (anon-ключ) — без этого данные пользователей были бы видны всем в интернете',
    );
  } else {
    record(
      'Row Level Security (RLS) включён',
      false,
      `RLS не включён для: ${notEnabled.join(', ')}`,
      'Запусти `npm run db:migrate` — миграция enable_rls ещё не применена',
    );
  }
}

interface JsonOutput {
  ok: boolean;
  checks: CheckResult[];
}

async function main(): Promise<void> {
  const jsonMode = argvHas('--json');
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const connectionTarget = maskConnectionTarget(env.DATABASE_URL);
  if (!jsonMode) {
    console.log(`\nПроверка схемы базы данных (${connectionTarget})...\n`);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await checkTablesExist(sql);
    await checkMigrationsJournal(sql);
    await checkVectorColumn(sql);
    await checkNullability(sql);
    await checkHnswIndex(sql);
    await checkUsersConstraints(sql);
    await checkRls(sql);
  } finally {
    await sql.end();
  }

  const allOk = results.every((r) => r.ok);

  if (jsonMode) {
    const output: JsonOutput = { ok: allOk, checks: results };
    console.log(JSON.stringify(output, null, 2));
  } else if (allOk) {
    console.log('\nSCHEMA OK');
  } else {
    console.log('\nСхема базы данных не соответствует ожиданиям. Что делать:');
    let i = 1;
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`${i}. ${r.name}: ${r.remediation ?? 'см. сообщение выше'}`);
      i += 1;
    }
  }

  process.exit(allOk ? 0 : 1);
}

// Без этого .catch() любая ошибка базы (неверный пароль, база не отвечает,
// нет прав на системные таблицы) вылетала бы как «unhandled promise
// rejection» — простынёй технического стектрейса, мимо всех подсказок,
// написанных выше по-русски.
main().catch((err) => {
  console.error(
    `\n[ОШИБКА] ${err instanceof Error ? err.message : String(err)}\n\n` +
      'Проверить схему базы не удалось — до самих проверок дело не дошло.\n' +
      'Скорее всего дело в строке подключения DATABASE_URL в файле .env:\n' +
      '1. Открой файл .env в корне проекта и найди строку DATABASE_URL=...\n' +
      '2. Сравни её со строкой из Supabase: Dashboard -> Connect -> Session pooler\n' +
      '   (нужен именно Session pooler, порт 5432, а не Transaction pooler на 6543).\n' +
      '3. Пароль внутри этой строки — это пароль базы данных, а не пароль от аккаунта.\n' +
      '4. Сохрани .env и запусти ещё раз: npm run verify-schema\n' +
      'Содержимое .env никому не показывай — там пароль.',
  );
  process.exit(1);
});
