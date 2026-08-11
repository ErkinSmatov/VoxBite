/**
 * Drizzle client over postgres.js (the driver chosen in Plan 01 — `pg` is
 * not installed).
 *
 * `createDb()` reads DATABASE_URL lazily, inside the function body, via
 * `loadEnv()`. Never at module import time — importing this module (e.g.
 * transitively from a Vitest test file) must never open a socket or crash
 * on a machine with no `.env`.
 *
 * Pitfall (01-RESEARCH.md #4): DATABASE_URL must be the Supabase **Session
 * pooler** endpoint (port 5432), not the Transaction pooler (port 6543).
 * The Transaction pooler does not support prepared statements, which both
 * postgres.js's default mode and drizzle-kit migrate rely on — using it
 * would silently break migrations.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from '../config/env.js';
import * as schema from './schema/index.js';

export type Db = ReturnType<typeof buildDb>;

let cachedSql: ReturnType<typeof postgres> | undefined;
let cachedDb: Db | undefined;

function buildDb(databaseUrl: string) {
  cachedSql = postgres(databaseUrl, { max: 5, prepare: true });
  return drizzle(cachedSql, { schema });
}

export function createDb(): Db {
  if (cachedDb) {
    return cachedDb;
  }
  const env = loadEnv();
  cachedDb = buildDb(env.DATABASE_URL);
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end({ timeout: 5 });
    cachedSql = undefined;
    cachedDb = undefined;
  }
}
