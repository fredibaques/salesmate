CREATE TABLE "kb_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_files_source_id_unique" UNIQUE("source_id")
);
--> statement-breakpoint
ALTER TABLE "kb_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "kb_documents" ADD COLUMN "content" text;--> statement-breakpoint
ALTER TABLE "knowledge_tables" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "kb_files" ADD CONSTRAINT "kb_files_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_files" ADD CONSTRAINT "kb_files_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" DROP COLUMN "reliability";--> statement-breakpoint
ALTER TABLE "knowledge_sources" DROP COLUMN "validated_at";--> statement-breakpoint
ALTER TABLE "knowledge_sources" DROP COLUMN "validated_by";--> statement-breakpoint
CREATE POLICY "kb_files_tenant_isolation" ON "kb_files" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));