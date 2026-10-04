-- Role used for every tenant-scoped request (see src/server/db/tenant.ts).
-- It is NOLOGIN: the application connects as the database owner and switches
-- to it with SET LOCAL ROLE inside each transaction, so RLS always applies,
-- even when the owner is a superuser (local/PGlite) or bypasses RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'salesmate_app') THEN
    CREATE ROLE salesmate_app NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT salesmate_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO salesmate_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salesmate_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO salesmate_app;
