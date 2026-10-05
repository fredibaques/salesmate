CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_config_id" uuid,
	"run_id" uuid,
	"dedupe_key" text NOT NULL,
	"company_name" text NOT NULL,
	"website" text,
	"sector" text,
	"city" text,
	"region" text,
	"country" text,
	"phone" text,
	"email" text,
	"contact_name" text,
	"contact_role" text,
	"linkedin_url" text,
	"fit_score" integer,
	"fit_reason" text,
	"sources" text[] DEFAULT '{}'::text[] NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_project_key_uq" UNIQUE("project_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "tools" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "schedule" jsonb;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "last_scheduled_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospects_project_created_idx" ON "prospects" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE POLICY "prospects_tenant_isolation" ON "prospects" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));