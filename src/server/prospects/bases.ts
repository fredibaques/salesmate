import { and, asc, count, eq, isNotNull } from "drizzle-orm";
import { DEFAULT_COMPANY_COLUMNS } from "@/lib/prospect-columns";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { agentConfigs, prospectBases, prospects } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";

/**
 * Prospect bases are tables of the project: the user decides their columns,
 * prospecting agents fill them and people review and export them. Any agent
 * of the project can work on any base.
 */

export type ProspectBase = typeof prospectBases.$inferSelect;

export async function getBase(db: Db, tenant: Pick<TenantContext, "orgId">, baseId: string) {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select().from(prospectBases).where(eq(prospectBases.id, baseId)),
  );
  return row ?? null;
}

/** The project's bases with their row counts and the agents that fill them. */
export async function listBases(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const bases = await tx
      .select()
      .from(prospectBases)
      .where(eq(prospectBases.projectId, projectId))
      .orderBy(asc(prospectBases.createdAt));
    const counts = await tx
      .select({ baseId: prospects.baseId, n: count() })
      .from(prospects)
      .where(eq(prospects.projectId, projectId))
      .groupBy(prospects.baseId);
    const agents = await tx
      .select({ baseId: agentConfigs.prospectBaseId, agentType: agentConfigs.agentType })
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.projectId, projectId),
          isNotNull(agentConfigs.addedAt),
          isNotNull(agentConfigs.prospectBaseId),
        ),
      );
    return bases.map((b) => ({
      ...b,
      rows: Number(counts.find((c) => c.baseId === b.id)?.n ?? 0),
      agents: agents.filter((a) => a.baseId === b.id).map((a) => a.agentType),
    }));
  });
}

async function createDefaultBase(tx: Tx, tenant: TenantContext, projectId: string) {
  const [base] = await tx
    .insert(prospectBases)
    .values({
      orgId: tenant.orgId,
      projectId,
      name: "Prospectos",
      rowKind: "company",
      columns: DEFAULT_COMPANY_COLUMNS,
      createdBy: tenant.actorType === "user" ? tenant.actorId : null,
    })
    .returning();
  await audit(tx, tenant, {
    event: "prospect_base.created",
    projectId,
    entityType: "prospect_base",
    entityId: base.id,
    data: { name: base.name },
  });
  return base;
}

/**
 * The base an agent fills. An agent without one gets the project's first
 * base, or a new «Prospectos» base when the project has none.
 */
export async function ensureAgentBase(
  db: Db,
  tenant: TenantContext,
  agentConfigId: string,
): Promise<ProspectBase> {
  return withTenant(db, tenant, (tx) => ensureAgentBaseIn(tx, tenant, agentConfigId));
}

/** ensureAgentBase inside a transaction already open (adding an agent). */
export async function ensureAgentBaseIn(
  tx: Tx,
  tenant: TenantContext,
  agentConfigId: string,
): Promise<ProspectBase> {
  const [agent] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, agentConfigId));
  if (!agent) throw new Error("Agente no encontrado.");
  if (agent.prospectBaseId) {
    const [base] = await tx.select().from(prospectBases).where(eq(prospectBases.id, agent.prospectBaseId));
    if (base) return base;
  }
  const [first] = await tx
    .select()
    .from(prospectBases)
    .where(eq(prospectBases.projectId, agent.projectId))
    .orderBy(asc(prospectBases.createdAt))
    .limit(1);
  const base = first ?? (await createDefaultBase(tx, tenant, agent.projectId));
  await tx.update(agentConfigs).set({ prospectBaseId: base.id }).where(eq(agentConfigs.id, agent.id));
  return base;
}

/** Points an agent at one of the project's bases. */
export async function setAgentBase(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentConfigId: string,
  baseId: string,
) {
  return withTenant(db, tenant, async (tx) => {
    const [base] = await tx
      .select({ id: prospectBases.id, name: prospectBases.name })
      .from(prospectBases)
      .where(and(eq(prospectBases.id, baseId), eq(prospectBases.projectId, projectId)));
    if (!base) throw new Error("Esa base no es de este proyecto.");
    const [agent] = await tx
      .update(agentConfigs)
      .set({ prospectBaseId: base.id })
      .where(and(eq(agentConfigs.id, agentConfigId), eq(agentConfigs.projectId, projectId)))
      .returning({ id: agentConfigs.id, agentType: agentConfigs.agentType });
    if (!agent) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.base_changed",
      projectId,
      entityType: "agent_config",
      entityId: agent.id,
      data: { agentType: agent.agentType, base: base.name },
    });
  });
}
