import { and, arrayContains, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { agentConfigs, playbooks, playbookVersions, type AgentType, type SalesMotion } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { PLAYBOOK_TEMPLATES, playbookSpecSchema, type PlaybookSpec } from "./spec";

export type PlaybookRow = typeof playbooks.$inferSelect;
export type PlaybookWithSpec = PlaybookRow & { versionId: string; spec: PlaybookSpec };

export async function listPlaybooks(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, (tx) =>
    tx.select().from(playbooks).where(eq(playbooks.projectId, projectId)).orderBy(asc(playbooks.name)),
  );
}

async function loadCurrent(tx: Tx, playbook: PlaybookRow): Promise<PlaybookWithSpec> {
  const [version] = await tx
    .select()
    .from(playbookVersions)
    .where(
      and(
        eq(playbookVersions.playbookId, playbook.id),
        eq(playbookVersions.version, playbook.currentVersion),
      ),
    );
  return { ...playbook, versionId: version.id, spec: playbookSpecSchema.parse(version.spec) };
}

export async function getPlaybook(db: Db, tenant: Pick<TenantContext, "orgId">, playbookId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.select().from(playbooks).where(eq(playbooks.id, playbookId));
    if (!row) return null;
    const current = await loadCurrent(tx, row);
    const history = await tx
      .select({
        id: playbookVersions.id,
        version: playbookVersions.version,
        notes: playbookVersions.notes,
        createdAt: playbookVersions.createdAt,
        createdBy: playbookVersions.createdBy,
      })
      .from(playbookVersions)
      .where(eq(playbookVersions.playbookId, playbookId))
      .orderBy(desc(playbookVersions.version));
    return { ...current, history };
  });
}

/**
 * The process an agent follows in a project: the playbook owned by the added
 * agent, or (for data from before agents owned their process) the most
 * recently updated active playbook for its type.
 */
export async function activePlaybookFor(
  tx: Tx,
  projectId: string,
  agentType: AgentType,
): Promise<PlaybookWithSpec | null> {
  const [owned] = await tx
    .select({ playbook: playbooks })
    .from(playbooks)
    .innerJoin(agentConfigs, eq(agentConfigs.id, playbooks.agentConfigId))
    .where(
      and(
        eq(agentConfigs.projectId, projectId),
        eq(agentConfigs.agentType, agentType),
        isNotNull(agentConfigs.addedAt),
      ),
    );
  if (owned) return loadCurrent(tx, owned.playbook);
  const [row] = await tx
    .select()
    .from(playbooks)
    .where(
      and(
        eq(playbooks.projectId, projectId),
        eq(playbooks.status, "active"),
        isNull(playbooks.agentConfigId),
        arrayContains(playbooks.agentTypes, [agentType]),
      ),
    )
    .orderBy(desc(playbooks.updatedAt))
    .limit(1);
  return row ? loadCurrent(tx, row) : null;
}

export async function createPlaybook(
  db: Db,
  tenant: TenantContext,
  input: {
    projectId: string;
    name: string;
    salesMotion: SalesMotion;
    agentTypes?: AgentType[];
    spec?: PlaybookSpec;
  },
) {
  const spec = playbookSpecSchema.parse(input.spec ?? PLAYBOOK_TEMPLATES[input.salesMotion]);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .insert(playbooks)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        name: input.name,
        salesMotion: input.salesMotion,
        agentTypes: input.agentTypes ?? ["inbound"],
        createdBy: tenant.actorId,
      })
      .returning();
    await tx.insert(playbookVersions).values({
      orgId: tenant.orgId,
      playbookId: row.id,
      version: 1,
      spec,
      notes: "Creado a partir de la plantilla",
      createdBy: tenant.actorId,
    });
    await audit(tx, tenant, {
      event: "playbook.created",
      projectId: input.projectId,
      entityType: "playbook",
      entityId: row.id,
      data: { name: row.name, salesMotion: row.salesMotion },
    });
    return row;
  });
}

/** Saves a new version; previous versions stay for comparison. */
export async function savePlaybookVersion(
  db: Db,
  tenant: TenantContext,
  playbookId: string,
  input: {
    spec: unknown;
    notes?: string;
    name?: string;
    agentTypes?: AgentType[];
    salesMotion?: SalesMotion;
  },
) {
  const spec = playbookSpecSchema.parse(input.spec);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.select().from(playbooks).where(eq(playbooks.id, playbookId)).for("update");
    if (!row) throw new Error("Playbook no encontrado.");
    const version = row.currentVersion + 1;
    await tx.insert(playbookVersions).values({
      orgId: tenant.orgId,
      playbookId,
      version,
      spec,
      notes: input.notes,
      createdBy: tenant.actorId,
    });
    const [updated] = await tx
      .update(playbooks)
      .set({
        currentVersion: version,
        ...(input.name ? { name: input.name } : {}),
        ...(input.agentTypes ? { agentTypes: input.agentTypes } : {}),
        ...(input.salesMotion ? { salesMotion: input.salesMotion } : {}),
      })
      .where(eq(playbooks.id, playbookId))
      .returning();
    await audit(tx, tenant, {
      event: "playbook.version_saved",
      projectId: row.projectId,
      entityType: "playbook",
      entityId: playbookId,
      data: { version, notes: input.notes },
    });
    return updated;
  });
}

export async function setPlaybookStatus(
  db: Db,
  tenant: TenantContext,
  playbookId: string,
  status: "draft" | "active" | "archived",
) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.update(playbooks).set({ status }).where(eq(playbooks.id, playbookId)).returning();
    if (!row) throw new Error("Playbook no encontrado.");
    await audit(tx, tenant, {
      event: `playbook.${status}`,
      projectId: row.projectId,
      entityType: "playbook",
      entityId: row.id,
    });
    return row;
  });
}
