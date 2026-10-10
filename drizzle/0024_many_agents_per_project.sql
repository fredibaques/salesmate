ALTER TABLE "agent_configs" DROP CONSTRAINT "agent_configs_project_agent_uq";--> statement-breakpoint
ALTER TABLE "actions" ADD COLUMN "agent_config_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "agent_config_id" uuid;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD COLUMN "agent_config_id" uuid;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_configs_project_idx" ON "agent_configs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_config_id","started_at");--> statement-breakpoint
-- Until now a project had one agent of each kind: that one ran each run and proposed each action.
UPDATE "agent_runs" r SET "agent_config_id" = c."id"
  FROM "agent_configs" c
  WHERE c."project_id" = r."project_id" AND c."agent_type" = r."agent_type" AND r."agent_config_id" IS NULL;--> statement-breakpoint
UPDATE "actions" a SET "agent_config_id" = c."id"
  FROM "agent_configs" c
  WHERE c."project_id" = a."project_id" AND c."agent_type" = a."agent_type" AND a."agent_config_id" IS NULL;
