-- Enables Row Level Security (RLS) on "processed_updates" and
-- "diary_drafts".
--
-- Plain-language note for the owner: Row Level Security is a Postgres
-- switch that makes a table return zero rows to anyone who has not been
-- explicitly granted a policy. Supabase automatically exposes every table
-- in the `public` schema over a public web API (PostgREST), reachable by
-- anyone who knows the project's public "anon" key — that key is public by
-- design, it ships in client-side code. Without RLS, these tables would be
-- world-readable to anyone who learns the project URL. "diary_drafts" holds
-- what people ate (health/diet data) and "processed_updates" holds Telegram
-- user ids — both need the switch on, exactly like "users", "diary",
-- "fdc_foods" and "bot_sessions" before them (see
-- `drizzle/0002_enable_rls.sql` and `drizzle/0004_bot_sessions_rls.sql`).
--
-- With RLS turned on and zero policies defined below, the PostgREST API
-- returns nothing for these tables (deny-all by default), while this
-- project's own backend connection (the `postgres` role, which carries the
-- BYPASSRLS privilege on Supabase) keeps full read/write access exactly as
-- before. No application code changes are required. The bot itself connects
-- with the database owner role, which bypasses RLS, so the bot keeps
-- working normally.
ALTER TABLE "processed_updates" ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicitly revoke table grants from Supabase's
-- built-in `anon`/`authenticated` API roles, if they exist on this
-- database. Guarded with an existence check so this migration is a no-op
-- (does not error) on a non-Supabase Postgres instance that has no such
-- roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "processed_updates" FROM anon, authenticated;
  END IF;
END $$;

ALTER TABLE "diary_drafts" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "diary_drafts" FROM anon, authenticated;
  END IF;
END $$;
