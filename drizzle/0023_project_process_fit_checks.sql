ALTER TABLE "prospects" ADD COLUMN "fit_checks" jsonb;--> statement-breakpoint
-- The sales process belongs to the project now: each project without one keeps the
-- process of its inbound agent (or, failing that, its most recently updated one).
UPDATE "playbooks" SET "agent_config_id" = NULL, "name" = 'Proceso de venta', "status" = 'active'
WHERE "id" IN (
  SELECT DISTINCT ON (p."project_id") p."id"
  FROM "playbooks" p
  LEFT JOIN "agent_configs" a ON a."id" = p."agent_config_id"
  WHERE NOT EXISTS (
    SELECT 1 FROM "playbooks" x
    WHERE x."project_id" = p."project_id" AND x."agent_config_id" IS NULL AND x."status" = 'active'
  )
  ORDER BY p."project_id", (a."agent_type" = 'inbound' AND a."added_at" IS NOT NULL) DESC NULLS LAST, p."updated_at" DESC
);
