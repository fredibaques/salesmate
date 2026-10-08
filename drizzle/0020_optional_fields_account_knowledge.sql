ALTER TABLE "knowledge_sources" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "prospect_bases" ADD COLUMN "hidden_fields" text[] DEFAULT '{}'::text[] NOT NULL;