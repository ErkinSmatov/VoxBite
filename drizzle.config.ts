/**
 * drizzle-kit configuration.
 *
 * This project uses `drizzle-kit generate` (produces a reviewable SQL file
 * under `drizzle/`) followed by `drizzle-kit migrate` (applies committed SQL
 * files in order) — ONLY. `drizzle-kit push` is banned: it diffs the live
 * database directly and applies changes with no history and no review step,
 * and can silently drop columns. Every schema change in this project must
 * be a committed SQL file someone can read before it touches the real
 * Supabase database.
 */
import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/config/env';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: loadEnv().DATABASE_URL },
  verbose: true,
  strict: true,
});
