ALTER TABLE "agent_runs" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "web_searches" integer DEFAULT 0 NOT NULL;