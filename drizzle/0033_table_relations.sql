CREATE TABLE "prospect_base_projects" (
	"org_id" text NOT NULL,
	"base_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_base_projects_base_id_project_id_pk" PRIMARY KEY("base_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "prospect_base_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prospect_link_searches" (
	"org_id" text NOT NULL,
	"base_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"run_id" uuid,
	"searched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_link_searches_base_id_row_id_pk" PRIMARY KEY("base_id","row_id")
);
--> statement-breakpoint
ALTER TABLE "prospect_link_searches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "prospect_base_projects" ADD CONSTRAINT "prospect_base_projects_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_base_projects" ADD CONSTRAINT "prospect_base_projects_base_id_prospect_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."prospect_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_base_projects" ADD CONSTRAINT "prospect_base_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_link_searches" ADD CONSTRAINT "prospect_link_searches_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_link_searches" ADD CONSTRAINT "prospect_link_searches_base_id_prospect_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."prospect_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_link_searches" ADD CONSTRAINT "prospect_link_searches_row_id_prospects_id_fk" FOREIGN KEY ("row_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospect_base_projects_project_idx" ON "prospect_base_projects" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_parent_id_prospects_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_parent_idx" ON "prospects" USING btree ("parent_id");--> statement-breakpoint
CREATE POLICY "prospect_base_projects_tenant_isolation" ON "prospect_base_projects" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));--> statement-breakpoint
CREATE POLICY "prospect_link_searches_tenant_isolation" ON "prospect_link_searches" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));