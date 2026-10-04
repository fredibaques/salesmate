ALTER TABLE "kb_chunks" ADD COLUMN "search_text" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "kb_chunks" ALTER COLUMN "search_text" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "kb_chunks" DROP COLUMN "tsv";--> statement-breakpoint
ALTER TABLE "kb_chunks" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_chunks_tsv_idx" ON "kb_chunks" USING gin ("tsv");
