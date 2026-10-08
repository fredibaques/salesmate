ALTER TABLE "prospect_bases" DROP CONSTRAINT "prospect_bases_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "prospects" DROP CONSTRAINT "prospects_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "prospect_bases" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_bases" ADD COLUMN "intake_key" text;--> statement-breakpoint
ALTER TABLE "prospect_bases" ADD CONSTRAINT "prospect_bases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;