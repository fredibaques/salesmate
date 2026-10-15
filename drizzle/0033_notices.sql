ALTER TABLE "agent_runs" ADD COLUMN "notice" jsonb;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "notices_seen_at" timestamp with time zone;