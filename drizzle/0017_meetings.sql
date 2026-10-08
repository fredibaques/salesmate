CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"action_id" uuid,
	"conversation_id" uuid,
	"connection_id" uuid,
	"calendar_event_id" text,
	"meet_code" text,
	"title" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"attendees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript_status" text DEFAULT 'waiting' NOT NULL,
	"transcript" jsonb,
	"transcript_doc_url" text,
	"summary" text,
	"next_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"last_error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_action_uq" UNIQUE("action_id")
);
--> statement-breakpoint
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meetings_project_idx" ON "meetings" USING btree ("project_id","start_at");--> statement-breakpoint
CREATE INDEX "meetings_transcript_idx" ON "meetings" USING btree ("transcript_status","end_at");--> statement-breakpoint
CREATE POLICY "meetings_tenant_isolation" ON "meetings" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));