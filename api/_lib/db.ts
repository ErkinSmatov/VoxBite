/**
 * db — the Mini App API's Postgres access, reusing `src/db/client.ts`'s
 * `createDb()` rather than constructing a second postgres.js pool.
 * `createDb()` already caches its connection lazily, keyed off `DATABASE_URL`
 * (read via `loadEnv()`), so the API and the bot process share one client
 * shape (though each is its own process/runtime and gets its own cached
 * instance).
 *
 * `getDb()` is a function, not a top-level `const db = createDb()`, so
 * importing this module in a test never opens a socket or reads env vars at
 * import time — only when a handler actually calls `getDb()`.
 *
 * CONTINGENCY (04.1-RESEARCH.md Open Question #3): Vercel serverless
 * functions are short-lived and can open many concurrent connections under
 * load. If Vercel functions ever report connection-exhaustion errors, the
 * fix is to point the API's `DATABASE_URL` at Supabase's transaction-mode
 * pooler port (6543), not to hand-roll pooling here — reuse the existing
 * session-pooler `DATABASE_URL` for v1 (closed beta, low concurrency).
 */
import { createDb, type Db } from '../../src/db/client';

export function getDb(): Db {
  return createDb();
}

export type { Db };
