CREATE TABLE "org_ai" (
	"org_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"key_encrypted" text NOT NULL,
	"key_hint" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"error_kind" text,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_ai" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_ai" ADD CONSTRAINT "org_ai_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "org_ai_tenant_isolation" ON "org_ai" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));