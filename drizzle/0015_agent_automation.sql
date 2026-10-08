CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"agent_config_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"run_id" uuid
);
--> statement-breakpoint
ALTER TABLE "agent_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "hook_token" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "contact_action_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_pending_idx" ON "agent_events" USING btree ("agent_config_id","processed_at");--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_hook_token_unique" UNIQUE("hook_token");--> statement-breakpoint
CREATE POLICY "agent_events_tenant_isolation" ON "agent_events" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));