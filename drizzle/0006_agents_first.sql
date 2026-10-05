ALTER TABLE "agent_configs" ADD COLUMN "added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD COLUMN "channels" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" ADD COLUMN "agent_config_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sales_profile" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_agent_config_id_unique" UNIQUE("agent_config_id");--> statement-breakpoint
-- Shared sales information moves from playbooks to the project: take it from
-- each project's most relevant playbook (active first, then most recent).
UPDATE "projects" p SET "sales_profile" = jsonb_strip_nulls(jsonb_build_object(
  'valueProposition', v.spec->'valueProposition',
  'segment', v.spec->'segment',
  'decisionMakers', v.spec->'decisionMakers',
  'pains', v.spec->'pains',
  'objections', v.spec->'objections',
  'tone', v.spec->'tone',
  'signature', v.spec->'signature'
))
FROM (
  SELECT DISTINCT ON (pb.project_id) pb.project_id, pv.spec
  FROM "playbooks" pb
  JOIN "playbook_versions" pv ON pv.playbook_id = pb.id AND pv.version = pb.current_version
  ORDER BY pb.project_id, (pb.status = 'active') DESC, pb.updated_at DESC
) v
WHERE v.project_id = p.id AND p.sales_profile = '{}'::jsonb;
--> statement-breakpoint
-- Each agent gets the most recent active playbook of its type as its process.
UPDATE "playbooks" pb SET "agent_config_id" = x.agent_id
FROM (
  SELECT DISTINCT ON (ac.id) ac.id AS agent_id, p2.id AS playbook_id
  FROM "agent_configs" ac
  JOIN "playbooks" p2
    ON p2.project_id = ac.project_id AND p2.agent_types[1] = ac.agent_type AND p2.status = 'active'
  ORDER BY ac.id, p2.updated_at DESC
) x
WHERE pb.id = x.playbook_id;
--> statement-breakpoint
-- Agents that were enabled or already had a process count as added to their project.
UPDATE "agent_configs" SET "added_at" = now()
WHERE "enabled" OR "id" IN (SELECT "agent_config_id" FROM "playbooks" WHERE "agent_config_id" IS NOT NULL);
--> statement-breakpoint
-- The inbound agent writes from the project's default mailbox.
UPDATE "agent_configs" ac SET "channels" = jsonb_build_object('mailboxId', pi.identity_id, 'readMailbox', true)
FROM "project_identities" pi
JOIN "identities" i ON i.id = pi.identity_id AND i.kind = 'email'
WHERE pi.project_id = ac.project_id AND pi.is_default
  AND ac.agent_type = 'inbound' AND ac.added_at IS NOT NULL;
