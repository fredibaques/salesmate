import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { Db } from "../db/client";
import {
  kbFiles,
  actions,
  AGENT_TYPES,
  agentConfigs,
  auditLog,
  complianceRules,
  connections,
  identities,
  knowledgeSources,
  knowledgeTables,
  meetingTypes,
  projectConnections,
  projectIdentities,
  projects,
  suppressions,
  type AgentType,
  type WeeklyHours,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { normalizeDomain, normalizeEmail, normalizePhone } from "../gateway/targets";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:MM");

export const projectInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional(),
  website: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  timezone: z.string().trim().min(3).default("Europe/Madrid"),
  languages: z.array(z.string().trim().min(2).max(5)).min(1).default(["es"]),
});

export const projectSettingsInput = z.object({
  sendWindow: z.tuple([hhmm, hhmm]).optional(),
  sendDays: z.array(z.number().int().min(1).max(7)).optional(),
  crossProjectCooldownDays: z.number().int().min(0).max(365).optional(),
});

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("es", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function listProjects(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx.select().from(projects).orderBy(asc(projects.name));
    const pending = await tx
      .select({ projectId: actions.projectId, n: count() })
      .from(actions)
      .where(eq(actions.status, "pending_approval"))
      .groupBy(actions.projectId);
    const byProject = new Map(pending.map((p) => [p.projectId, p.n]));
    const agents = await tx
      .select({
        projectId: agentConfigs.projectId,
        agentType: agentConfigs.agentType,
        enabled: agentConfigs.enabled,
      })
      .from(agentConfigs)
      .where(isNotNull(agentConfigs.addedAt));
    return rows.map((p) => ({
      ...p,
      pendingApprovals: byProject.get(p.id) ?? 0,
      agents: agents.filter((a) => a.projectId === p.id),
    }));
  });
}

export async function getProject(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.select().from(projects).where(eq(projects.id, projectId));
    return row ?? null;
  });
}

export async function createProject(db: Db, tenant: TenantContext, raw: z.input<typeof projectInput>) {
  const input = projectInput.parse(raw);
  if (!isValidTimezone(input.timezone)) throw new Error(`Zona horaria no válida: ${input.timezone}`);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .insert(projects)
      .values({ ...input, orgId: tenant.orgId, createdBy: tenant.actorId })
      .returning();
    // Every agent starts disabled and in draft mode (level 1).
    await tx.insert(agentConfigs).values(
      AGENT_TYPES.map((agentType) => ({
        orgId: tenant.orgId,
        projectId: row.id,
        agentType,
        enabled: false,
        autonomy: { default: 1 },
      })),
    );
    await audit(tx, tenant, {
      event: "project.created",
      projectId: row.id,
      entityType: "project",
      entityId: row.id,
      data: { name: row.name },
    });
    return row;
  });
}

export async function updateProject(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  raw: z.input<typeof projectInput> & { settings?: z.input<typeof projectSettingsInput> },
) {
  const input = projectInput.parse(raw);
  const settings = projectSettingsInput.parse(raw.settings ?? {});
  if (!isValidTimezone(input.timezone)) throw new Error(`Zona horaria no válida: ${input.timezone}`);
  return withTenant(db, tenant, async (tx) => {
    const [current] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!current) throw new Error("Proyecto no encontrado.");
    const [row] = await tx
      .update(projects)
      .set({ ...input, settings: { ...current.settings, ...settings } })
      .where(eq(projects.id, projectId))
      .returning();
    await audit(tx, tenant, {
      event: "project.updated",
      projectId,
      entityType: "project",
      entityId: projectId,
      data: { ...input, settings },
    });
    return row;
  });
}

/**
 * Deletes a project and everything that belongs to it (agents, knowledge,
 * conversations, prospects, rules…) through the foreign keys' cascades.
 * The organization's connections stay, and so does the audit log, which
 * records the deletion. `confirmName` must match, to avoid accidents.
 */
export async function deleteProject(db: Db, tenant: TenantContext, projectId: string, confirmName: string) {
  return withTenant(db, tenant, async (tx) => {
    const [current] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!current) throw new Error("Proyecto no encontrado.");
    if (confirmName.trim() !== current.name.trim()) {
      throw new Error("Escribe el nombre del proyecto exactamente igual para confirmar.");
    }
    await tx.delete(projects).where(eq(projects.id, projectId));
    await audit(tx, tenant, {
      event: "project.deleted",
      projectId,
      entityType: "project",
      entityId: projectId,
      data: { name: current.name },
    });
  });
}

/** Kill switch and lifecycle. */
export async function setProjectState(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  patch: { agentsPaused?: boolean; status?: "active" | "paused" | "archived" },
) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.update(projects).set(patch).where(eq(projects.id, projectId)).returning();
    if (!row) throw new Error("Proyecto no encontrado.");
    await audit(tx, tenant, {
      event:
        patch.agentsPaused === true
          ? "project.agents_paused"
          : patch.agentsPaused === false
            ? "project.agents_resumed"
            : "project.status_changed",
      projectId,
      entityType: "project",
      entityId: projectId,
      data: patch,
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Channels: identities and connections of a project
// ---------------------------------------------------------------------------

export async function getProjectChannels(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const allIdentities = await tx
      .select()
      .from(identities)
      .orderBy(asc(identities.kind), asc(identities.address));
    const assigned = await tx
      .select()
      .from(projectIdentities)
      .where(eq(projectIdentities.projectId, projectId));
    const allConnections = await tx.select().from(connections).orderBy(asc(connections.label));
    const linked = await tx
      .select()
      .from(projectConnections)
      .where(eq(projectConnections.projectId, projectId));
    return {
      identities: allIdentities.map((i) => ({
        ...i,
        assigned: assigned.some((a) => a.identityId === i.id),
        isDefault: assigned.find((a) => a.identityId === i.id)?.isDefault ?? false,
      })),
      connections: allConnections.map(({ credentialsEncrypted: _secret, ...c }) => ({
        ...c,
        linkedCapabilities: linked.find((l) => l.connectionId === c.id)?.capabilities ?? null,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Meeting types
// ---------------------------------------------------------------------------

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export const meetingTypeInput = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["demo", "discovery", "closing_call", "callback", "custom"]),
  durationMinutes: z.number().int().min(5).max(480),
  bufferBeforeMinutes: z.number().int().min(0).max(240).default(0),
  bufferAfterMinutes: z.number().int().min(0).max(240).default(10),
  minNoticeMinutes: z.number().int().min(0).max(20160).default(240),
  horizonDays: z.number().int().min(1).max(90).default(14),
  slotStepMinutes: z.number().int().min(5).max(240).default(30),
  days: z.array(z.enum(DAY_KEYS)).min(1),
  from: hhmm,
  to: hhmm,
  hostUserId: z.string().min(1),
  calendarIdentityId: z.string().uuid().optional(),
  location: z.string().trim().max(500).optional(),
});

export async function listMeetingTypes(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(meetingTypes)
      .where(eq(meetingTypes.projectId, projectId))
      .orderBy(asc(meetingTypes.name)),
  );
}

export async function createMeetingType(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  raw: z.input<typeof meetingTypeInput>,
) {
  const input = meetingTypeInput.parse(raw);
  if (input.from >= input.to) throw new Error("La hora de inicio debe ser anterior a la de fin.");
  const weeklyHours: WeeklyHours = Object.fromEntries(input.days.map((d) => [d, [[input.from, input.to]]]));
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .insert(meetingTypes)
      .values({
        orgId: tenant.orgId,
        projectId,
        name: input.name,
        kind: input.kind,
        durationMinutes: input.durationMinutes,
        bufferBeforeMinutes: input.bufferBeforeMinutes,
        bufferAfterMinutes: input.bufferAfterMinutes,
        minNoticeMinutes: input.minNoticeMinutes,
        horizonDays: input.horizonDays,
        slotStepMinutes: input.slotStepMinutes,
        weeklyHours,
        hostUserId: input.hostUserId,
        calendarIdentityId: input.calendarIdentityId,
        location: input.location,
      })
      .returning();
    await audit(tx, tenant, {
      event: "meeting_type.created",
      projectId,
      entityType: "meeting_type",
      entityId: row.id,
      data: { name: row.name, kind: row.kind },
    });
    return row;
  });
}

export async function deleteMeetingType(db: Db, tenant: TenantContext, meetingTypeId: string) {
  await withTenant(db, tenant, async (tx) => {
    const [row] = await tx.delete(meetingTypes).where(eq(meetingTypes.id, meetingTypeId)).returning();
    if (row) {
      await audit(tx, tenant, {
        event: "meeting_type.deleted",
        projectId: row.projectId,
        entityType: "meeting_type",
        entityId: row.id,
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Rules: autonomy, limits, compliance, suppressions
// ---------------------------------------------------------------------------

export async function getProjectRules(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => ({
    agents: await tx.select().from(agentConfigs).where(eq(agentConfigs.projectId, projectId)),
    compliance: await tx
      .select()
      .from(complianceRules)
      .where(eq(complianceRules.projectId, projectId))
      .orderBy(asc(complianceRules.createdAt)),
    suppressions: await tx
      .select()
      .from(suppressions)
      .where(eq(suppressions.projectId, projectId))
      .orderBy(desc(suppressions.createdAt)),
  }));
}

export const agentConfigInput = z.object({
  enabled: z.boolean(),
  defaultLevel: z.number().int().min(0).max(3),
  actionLevels: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
  dailyLimits: z.record(z.string(), z.number().int().min(0).max(100_000)).default({}),
});

export async function updateAgentConfig(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: AgentType,
  raw: z.input<typeof agentConfigInput>,
) {
  const input = agentConfigInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const values = {
      enabled: input.enabled,
      autonomy: { default: input.defaultLevel, actions: input.actionLevels },
      limits: { daily: input.dailyLimits },
    };
    const [row] = await tx
      .insert(agentConfigs)
      .values({ orgId: tenant.orgId, projectId, agentType, ...values })
      .onConflictDoUpdate({ target: [agentConfigs.projectId, agentConfigs.agentType], set: values })
      .returning();
    await audit(tx, tenant, {
      event: "agent.config_updated",
      projectId,
      entityType: "agent_config",
      entityId: row.id,
      data: { agentType, ...values },
    });
    return row;
  });
}

export const complianceRuleInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("human_only"),
    description: z.string().trim().min(3),
    actionTypes: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal("mandatory_notice"),
    description: z.string().trim().min(3),
    actionTypes: z.array(z.string()).min(1),
    text: z.string().trim().min(3),
  }),
  z.object({
    kind: z.literal("channel_restriction"),
    description: z.string().trim().min(3),
    actionTypes: z.array(z.string()).min(1),
    customerTypes: z.array(z.enum(["b2b", "b2c"])).min(1),
  }),
  z.object({
    kind: z.literal("retention"),
    description: z.string().trim().min(3),
    days: z.number().int().min(1).max(3650),
  }),
]);

export async function addComplianceRule(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  raw: z.input<typeof complianceRuleInput>,
) {
  const { kind, description, ...spec } = complianceRuleInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .insert(complianceRules)
      .values({ orgId: tenant.orgId, projectId, kind, description, spec })
      .returning();
    await audit(tx, tenant, {
      event: "compliance_rule.added",
      projectId,
      entityType: "compliance_rule",
      entityId: row.id,
      data: { kind, description, spec },
    });
    return row;
  });
}

export async function removeComplianceRule(db: Db, tenant: TenantContext, ruleId: string) {
  await withTenant(db, tenant, async (tx) => {
    const [row] = await tx.delete(complianceRules).where(eq(complianceRules.id, ruleId)).returning();
    if (row) {
      await audit(tx, tenant, {
        event: "compliance_rule.removed",
        projectId: row.projectId,
        entityType: "compliance_rule",
        entityId: row.id,
        data: { description: row.description },
      });
    }
  });
}

export function normalizeSuppression(type: "email" | "domain" | "phone", value: string): string {
  const normalized =
    type === "email"
      ? normalizeEmail(value)
      : type === "domain"
        ? normalizeDomain(value)
        : normalizePhone(value);
  if (!normalized) throw new Error(`Valor no válido para ${type}: ${value}`);
  return normalized;
}

export async function addSuppression(
  db: Db,
  tenant: TenantContext,
  input: { projectId: string | null; type: "email" | "domain" | "phone"; value: string; reason?: string },
) {
  const value = normalizeSuppression(input.type, input.value);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .insert(suppressions)
      .values({
        orgId: tenant.orgId,
        projectId: input.projectId,
        type: input.type,
        value,
        reason: input.reason,
        createdBy: tenant.actorId,
      })
      .onConflictDoNothing()
      .returning();
    await audit(tx, tenant, {
      event: "suppression.added",
      projectId: input.projectId,
      entityType: "suppression",
      entityId: row?.id,
      data: { type: input.type, value },
    });
    return row ?? null;
  });
}

export async function removeSuppression(db: Db, tenant: TenantContext, suppressionId: string) {
  await withTenant(db, tenant, async (tx) => {
    const [row] = await tx.delete(suppressions).where(eq(suppressions.id, suppressionId)).returning();
    if (row) {
      await audit(tx, tenant, {
        event: "suppression.removed",
        projectId: row.projectId,
        entityType: "suppression",
        entityId: row.id,
        data: { type: row.type, value: row.value },
      });
    }
  });
}

export async function listGlobalSuppressions(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(suppressions)
      .where(isNull(suppressions.projectId))
      .orderBy(desc(suppressions.createdAt)),
  );
}

// ---------------------------------------------------------------------------
// Knowledge listing
// ---------------------------------------------------------------------------

export async function listKnowledge(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const sources = await tx
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.projectId, projectId))
      .orderBy(desc(knowledgeSources.createdAt));
    const tables = sources.length
      ? await tx
          .select()
          .from(knowledgeTables)
          .where(
            inArray(
              knowledgeTables.sourceId,
              sources.map((s) => s.id),
            ),
          )
      : [];
    const files = sources.length
      ? await tx
          .select({ sourceId: kbFiles.sourceId, filename: kbFiles.filename, size: kbFiles.size })
          .from(kbFiles)
          .where(
            inArray(
              kbFiles.sourceId,
              sources.map((s) => s.id),
            ),
          )
      : [];
    return sources.map((s) => ({
      ...s,
      tables: tables.filter((t) => t.sourceId === s.id),
      file: files.find((f) => f.sourceId === s.id) ?? null,
    }));
  });
}

// ---------------------------------------------------------------------------
// Inbox & audit
// ---------------------------------------------------------------------------

export async function listActions(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  filter: { statuses: (typeof actions.$inferSelect)["status"][]; projectId?: string; limit?: number },
) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select({ action: actions, projectName: projects.name })
      .from(actions)
      .innerJoin(projects, eq(projects.id, actions.projectId))
      .where(
        and(
          inArray(actions.status, filter.statuses),
          filter.projectId ? eq(actions.projectId, filter.projectId) : undefined,
        ),
      )
      .orderBy(desc(actions.createdAt))
      .limit(filter.limit ?? 100),
  );
}

export async function listAudit(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  filter: { projectId?: string; limit?: number } = {},
) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(filter.projectId ? eq(auditLog.projectId, filter.projectId) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(filter.limit ?? 200),
  );
}

export async function listOrgIdentities(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, (tx) => tx.select().from(identities).orderBy(asc(identities.address)));
}

export async function listOrgConnections(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx.select().from(connections).orderBy(asc(connections.label));
    return rows.map(({ credentialsEncrypted: _secret, ...rest }) => rest);
  });
}
