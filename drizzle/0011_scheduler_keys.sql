CREATE TABLE "scheduler_keys" (
	"name" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduler_keys" ENABLE ROW LEVEL SECURITY;