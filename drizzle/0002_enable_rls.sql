-- Enables Row Level Security (RLS) on all three application tables.
--
-- WHY this matters: Supabase automatically publishes every table in the
-- `public` schema through its PostgREST web API, reachable by anyone who
-- knows the project's public "anon" key (that key is public by design, it
-- ships in client-side code). Without RLS, "users" and "diary" rows —
-- including sex/age/weight/goal and the food diary — would be world
-- readable to anyone who learns the project URL.
--
-- With RLS turned on and zero policies defined below, the PostgREST API
-- returns nothing for these tables (deny-all by default), while this
-- project's own backend connection (the `postgres` role, which carries the
-- BYPASSRLS privilege on Supabase) keeps full read/write access exactly as
-- before. No application code changes are required.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fdc_foods" ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: explicitly revoke table grants from Supabase's
-- built-in `anon`/`authenticated` API roles, if they exist on this
-- database. Guarded with an existence check so this migration is a no-op
-- (does not error) on a non-Supabase Postgres instance that has no such
-- roles.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "users", "diary", "fdc_foods" FROM anon, authenticated;
  END IF;
END $$;
