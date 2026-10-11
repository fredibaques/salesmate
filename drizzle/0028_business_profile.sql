CREATE TABLE "org_profiles" (
	"org_id" text PRIMARY KEY NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_profiles" ADD CONSTRAINT "org_profiles_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "org_profiles_tenant_isolation" ON "org_profiles" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
-- «Tu negocio» starts from each organization's most complete project profile (and its web).
INSERT INTO "org_profiles" ("org_id", "profile", "updated_by")
SELECT DISTINCT ON ("org_id")
  "org_id",
  ("sales_profile" - 'fitSignals') || jsonb_build_object('website', coalesce("website", '')),
  "created_by"
FROM "projects"
WHERE "sales_profile" <> '{}'::jsonb
ORDER BY "org_id", (coalesce("sales_profile"->>'offer', '') <> '') DESC, "updated_at" DESC
ON CONFLICT ("org_id") DO NOTHING;
