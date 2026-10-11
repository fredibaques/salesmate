CREATE TABLE "web_pages" (
	"url" text PRIMARY KEY NOT NULL,
	"final_url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"html" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"via_jina" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_pages" ENABLE ROW LEVEL SECURITY;