ALTER TABLE "agent_configs" ADD COLUMN "schedule_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "schedule_note" text;