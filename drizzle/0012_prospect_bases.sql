CREATE TABLE "prospect_bases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"row_kind" text DEFAULT 'company' NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospect_bases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospects" DROP CONSTRAINT "prospects_project_key_uq";--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "prospect_base_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "base_id" uuid;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "person_name" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "cell_meta" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Every project that already has prospects or a prospecting agent gets a base
-- «Prospectos» with the columns prospects had until now, and keeps its values.
INSERT INTO "prospect_bases" ("org_id", "project_id", "name", "row_kind", "columns")
SELECT p."org_id", p."id", 'Prospectos', 'company', '[{"id":"sector","name":"Sector","type":"text","filledBy":"agent","instructions":"A qué se dedica la empresa, en pocas palabras."},{"id":"city","name":"Ciudad","type":"text","filledBy":"agent","instructions":"Ciudad de la sede."},{"id":"region","name":"Provincia / región","type":"text","filledBy":"agent","instructions":"Provincia o región de la sede."},{"id":"country","name":"País","type":"text","filledBy":"agent"},{"id":"phone","name":"Teléfono","type":"phone","filledBy":"agent","instructions":"Teléfono general o de ventas que publica la propia empresa."},{"id":"email","name":"Email","type":"email","filledBy":"agent","instructions":"Email general o de ventas que publica la propia empresa."},{"id":"contact","name":"Contacto","type":"text","filledBy":"agent","instructions":"Persona de contacto, solo si la empresa la publica para ser contactada."},{"id":"role","name":"Cargo","type":"text","filledBy":"agent","instructions":"Cargo de esa persona."},{"id":"linkedin","name":"LinkedIn","type":"url","filledBy":"agent","instructions":"Página de empresa."}]'::jsonb
FROM "projects" p
WHERE EXISTS (SELECT 1 FROM "prospects" x WHERE x."project_id" = p."id")
   OR EXISTS (SELECT 1 FROM "agent_configs" a WHERE a."project_id" = p."id" AND a."agent_type" = 'outbound' AND a."added_at" IS NOT NULL);--> statement-breakpoint
UPDATE "prospects" x SET
  "base_id" = b."id",
  "data" = x."data" || jsonb_strip_nulls(jsonb_build_object(
    'sector', x."sector", 'city', x."city", 'region', x."region", 'country', x."country",
    'phone', x."phone", 'email', x."email", 'contact', x."contact_name", 'role', x."contact_role",
    'linkedin', x."linkedin_url"))
FROM "prospect_bases" b WHERE b."project_id" = x."project_id";--> statement-breakpoint
UPDATE "agent_configs" a SET "prospect_base_id" = b."id"
FROM "prospect_bases" b WHERE b."project_id" = a."project_id" AND a."agent_type" = 'outbound';--> statement-breakpoint
ALTER TABLE "prospects" ALTER COLUMN "base_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_bases" ADD CONSTRAINT "prospect_bases_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_bases" ADD CONSTRAINT "prospect_bases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prospect_bases_project_idx" ON "prospect_bases" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_prospect_base_id_prospect_bases_id_fk" FOREIGN KEY ("prospect_base_id") REFERENCES "public"."prospect_bases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_base_id_prospect_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."prospect_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_base_key_uq" UNIQUE("base_id","dedupe_key");--> statement-breakpoint
CREATE POLICY "prospect_bases_tenant_isolation" ON "prospect_bases" AS PERMISSIVE FOR ALL TO "salesmate_app" USING (org_id = current_setting('app.org_id', true)) WITH CHECK (org_id = current_setting('app.org_id', true));