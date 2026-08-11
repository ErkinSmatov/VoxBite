-- Enables the pgvector extension, which adds the `vector` column type and
-- similarity operators used by fdc_foods.embedding (init_schema migration).
--
-- On Supabase this extension is usually already enabled from the project
-- dashboard (see Plan 01-02) and lives in the `extensions` schema — so on
-- Supabase this statement is normally a harmless no-op. It is included here
-- so this migration set also works unattended against a brand-new, empty
-- Postgres database (phase success criterion #1 requires that).
CREATE EXTENSION IF NOT EXISTS vector;
