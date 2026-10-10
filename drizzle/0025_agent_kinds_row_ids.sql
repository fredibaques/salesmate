ALTER TABLE "agent_runs" ADD COLUMN "target" jsonb;--> statement-breakpoint
ALTER TABLE "prospect_bases" ADD COLUMN "row_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "prospects_base_seq_idx" ON "prospects" USING btree ("base_id","seq");--> statement-breakpoint
-- Each row's ID in its table: 1, 2, 3… in the order rows arrived.
UPDATE "prospects" p SET "seq" = n.rn
  FROM (SELECT "id", row_number() OVER (PARTITION BY "base_id" ORDER BY "created_at", "id") AS rn FROM "prospects") n
  WHERE n."id" = p."id";--> statement-breakpoint
UPDATE "prospect_bases" b SET "row_seq" = coalesce((SELECT max("seq") FROM "prospects" p WHERE p."base_id" = b."id"), 0);--> statement-breakpoint
-- New rows take the next number of their table, whoever inserts them. A row
-- that is already there (the insert will be skipped as a duplicate) takes none,
-- so numbers have no gaps; numbers of deleted rows are not given again.
CREATE OR REPLACE FUNCTION "prospects_next_seq"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "prospects" WHERE "base_id" = NEW."base_id" AND "dedupe_key" = NEW."dedupe_key") THEN
    RETURN NEW;
  END IF;
  UPDATE "prospect_bases" SET "row_seq" = "row_seq" + 1 WHERE "id" = NEW."base_id" RETURNING "row_seq" INTO NEW."seq";
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "prospects_seq" BEFORE INSERT ON "prospects" FOR EACH ROW EXECUTE FUNCTION "prospects_next_seq"();--> statement-breakpoint
-- The agents that found rows were "outbound"; outbound is now the agent that writes to them.
UPDATE "agent_configs" SET "agent_type" = 'prospecting' WHERE "agent_type" = 'outbound';--> statement-breakpoint
UPDATE "agent_runs" SET "agent_type" = 'prospecting' WHERE "agent_type" = 'outbound';--> statement-breakpoint
UPDATE "actions" SET "agent_type" = 'prospecting' WHERE "agent_type" = 'outbound';
