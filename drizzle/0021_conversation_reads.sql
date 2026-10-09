CREATE TABLE "conversation_reads" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"person_key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_reads_org_id_user_id_person_key_pk" PRIMARY KEY("org_id","user_id","person_key")
);
--> statement-breakpoint
ALTER TABLE "conversation_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "conversation_reads_tenant_isolation" ON "conversation_reads" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));