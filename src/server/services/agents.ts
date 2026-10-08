import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import { ensureAgentBaseIn } from "../prospects/bases";
import { mcpToolsOf } from "../connectors/mcp";
import { connectionCapabilities } from "../connectors/service";
import type { Db } from "../db/client";
import {
  agentConfigs,
  agentRuns,
  connections,
  identities,
  playbooks,
  playbookVersions,
  projectConnections,
  projectIdentities,
  projects,
  PROSPECTING_MODES,
  type AgentChannels,
  type AgentSchedule,
  type AgentSettings,
  type AgentTools,
  type AgentType,
  type SalesMotion,
} from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { getPlaybook, savePlaybookVersion } from "../playbooks/service";
import {
  AGENT_PROCESS_FIELDS,
  PLAYBOOK_TEMPLATES,
  parseSalesProfile,
  playbookSpecSchema,
  salesProfileSchema,
  type PlaybookSpec,
} from "../playbooks/spec";

/**
 * Agents are the unit the user works with: they add an agent to a project,
 * describe its sales process and tell it which mailbox, calendar and CRM to
 * use. Each added agent owns exactly one playbook (its process, versioned).
 */

/** Agents a project can have, in display order. Others run at organization level. */
export const PROJECT_AGENT_TYPES = ["inbound", "outbound", "account_manager"] as const;
export type ProjectAgentType = (typeof PROJECT_AGENT_TYPES)[number];

/** Agents whose runtime exists today; the rest can't be added yet. */
export const AVAILABLE_AGENT_TYPES: readonly ProjectAgentType[] = ["inbound", "outbound"];

/** Agents that work on a schedule (the rest react to what arrives). */
export const SCHEDULED_AGENT_TYPES: readonly ProjectAgentType[] = ["outbound"];

/** Starting configuration of each template; the user edits all of it. */
export const AGENT_DEFAULTS: Record<
  ProjectAgentType,
  { instructions: string; tools: AgentTools; schedule: AgentSchedule | null; settings: AgentSettings }
> = {
  inbound: { instructions: "", tools: {}, schedule: null, settings: {} },
  outbound: {
    instructions: [
      "Busca en fuentes públicas (webs de empresas, directorios, asociaciones del sector, noticias) empresas que encajen con nuestro cliente ideal.",
      "Para cada una, recoge el nombre, la web, la ciudad, un teléfono y un email de contacto públicos si los hay, y explica en una frase por qué encaja.",
      "No incluyas empresas que ya sean clientes ni las que estén fuera de nuestra zona.",
    ].join("\n"),
    tools: { web: true },
    schedule: { time: "08:00", days: [1, 2, 3, 4, 5] },
    settings: { prospectsPerRun: 10, mode: "both", cellsPerRun: 20 },
  },
  account_manager: { instructions: "", tools: {}, schedule: null, settings: {} },
};

export function isProjectAgentType(value: string): value is ProjectAgentType {
  return (PROJECT_AGENT_TYPES as readonly string[]).includes(value);
}

const PROCESS_NAMES: Record<ProjectAgentType, string> = {
  inbound: "Proceso inbound",
  outbound: "Proceso outbound",
  account_manager: "Proceso de cartera",
};

async function findConfig(tx: Tx, projectId: string, agentType: AgentType) {
  const [row] = await tx
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)));
  return row ?? null;
}

async function currentSpec(tx: Tx, playbookId: string, version: number) {
  const [row] = await tx
    .select({ spec: playbookVersions.spec })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.playbookId, playbookId), eq(playbookVersions.version, version)));
  return row ? playbookSpecSchema.parse(row.spec) : null;
}

/** Agents added to a project, with a summary of their process. */
export async function listProjectAgents(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select({ config: agentConfigs, playbook: playbooks })
      .from(agentConfigs)
      .leftJoin(playbooks, eq(playbooks.agentConfigId, agentConfigs.id))
      .where(and(eq(agentConfigs.projectId, projectId), isNotNull(agentConfigs.addedAt)));
    const out = [];
    for (const { config, playbook } of rows) {
      const spec = playbook ? await currentSpec(tx, playbook.id, playbook.currentVersion) : null;
      out.push({ config, playbook, spec });
    }
    return out.sort(
      (a, b) =>
        PROJECT_AGENT_TYPES.indexOf(a.config.agentType as ProjectAgentType) -
        PROJECT_AGENT_TYPES.indexOf(b.config.agentType as ProjectAgentType),
    );
  });
}

/** The added agents of every project, for the sidebar. */
export async function listSidebarAgents(db: Db, tenant: Pick<TenantContext, "orgId">) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        projectId: agentConfigs.projectId,
        agentType: agentConfigs.agentType,
        enabled: agentConfigs.enabled,
      })
      .from(agentConfigs)
      .where(isNotNull(agentConfigs.addedAt)),
  );
  return rows
    .filter((r): r is typeof r & { agentType: ProjectAgentType } => isProjectAgentType(r.agentType))
    .sort((a, b) => PROJECT_AGENT_TYPES.indexOf(a.agentType) - PROJECT_AGENT_TYPES.indexOf(b.agentType));
}

/** One added agent with its process (current version and history). */
export async function getAgent(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  agentType: ProjectAgentType,
) {
  const base = await withTenant(db, tenant, async (tx) => {
    const config = await findConfig(tx, projectId, agentType);
    if (!config?.addedAt) return null;
    const [playbook] = await tx
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(eq(playbooks.agentConfigId, config.id));
    return { config, playbookId: playbook?.id ?? null };
  });
  if (!base) return null;
  const process = base.playbookId ? await getPlaybook(db, tenant, base.playbookId) : null;
  return { config: base.config, process };
}

/** Adds an agent to a project with the template process of the chosen sales motion. */
export async function addAgent(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  salesMotion: SalesMotion,
) {
  if (!AVAILABLE_AGENT_TYPES.includes(agentType)) throw new Error("Este agente todavía no está disponible.");
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .insert(agentConfigs)
      .values({
        orgId: tenant.orgId,
        projectId,
        agentType,
        addedAt: new Date(),
        enabled: false,
        ...AGENT_DEFAULTS[agentType],
      })
      .onConflictDoUpdate({
        target: [agentConfigs.projectId, agentConfigs.agentType],
        set: { addedAt: new Date() },
      })
      .returning();
    // Every project creates its agent rows up front: give a never-configured one its template defaults.
    if (!config.instructions && !config.schedule && Object.keys(config.tools).length === 0) {
      const defaults = AGENT_DEFAULTS[agentType];
      await tx
        .update(agentConfigs)
        .set({
          instructions: defaults.instructions || null,
          tools: defaults.tools,
          schedule: defaults.schedule,
          settings: defaults.settings,
        })
        .where(eq(agentConfigs.id, config.id));
    }
    const [existing] = await tx.select().from(playbooks).where(eq(playbooks.agentConfigId, config.id));
    if (!existing) {
      const [playbook] = await tx
        .insert(playbooks)
        .values({
          orgId: tenant.orgId,
          projectId,
          agentConfigId: config.id,
          name: PROCESS_NAMES[agentType],
          salesMotion,
          agentTypes: [agentType],
          status: "active",
          createdBy: tenant.actorId,
        })
        .returning();
      await tx.insert(playbookVersions).values({
        orgId: tenant.orgId,
        playbookId: playbook.id,
        version: 1,
        spec: playbookSpecSchema.parse(PLAYBOOK_TEMPLATES[salesMotion]),
        notes: "Creado a partir de la plantilla",
        createdBy: tenant.actorId,
      });
    }
    // A prospecting agent fills a base of the project from the start.
    if (agentType === "outbound") await ensureAgentBaseIn(tx, tenant, config.id);
    await audit(tx, tenant, {
      event: "agent.added",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType, salesMotion },
    });
    return config;
  });
}

/** Takes the agent out of the project. Its process is kept in case it is added again. */
export async function removeAgent(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
) {
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ addedAt: null, enabled: false })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await syncProjectChannels(tx, tenant.orgId, projectId);
    await audit(tx, tenant, {
      event: "agent.removed",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType },
    });
  });
}

export async function setAgentEnabled(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  enabled: boolean,
) {
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ enabled })
      .where(
        and(
          eq(agentConfigs.projectId, projectId),
          eq(agentConfigs.agentType, agentType),
          isNotNull(agentConfigs.addedAt),
        ),
      )
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: enabled ? "agent.enabled" : "agent.paused",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType },
    });
  });
}

/** Saves a new version of the agent's process; project-level fields are left untouched. */
export async function saveAgentProcess(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  input: { salesMotion?: SalesMotion; process: Partial<PlaybookSpec>; notes?: string },
) {
  const agent = await getAgent(db, tenant, projectId, agentType);
  if (!agent?.process) throw new Error("Agente no encontrado.");
  const merged: Record<string, unknown> = { ...agent.process.spec };
  for (const field of AGENT_PROCESS_FIELDS) {
    if (field in input.process) merged[field] = input.process[field];
  }
  return savePlaybookVersion(db, tenant, agent.process.id, {
    spec: merged,
    notes: input.notes,
    salesMotion: input.salesMotion,
  });
}

export const autonomyInput = z.object({
  defaultLevel: z.number().int().min(0).max(3),
  actionLevels: z.record(z.string(), z.number().int().min(0).max(3)).default({}),
  dailyLimits: z.record(z.string(), z.number().int().min(0).max(100_000)).default({}),
});

export async function updateAgentAutonomy(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  raw: z.input<typeof autonomyInput>,
) {
  const input = autonomyInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const values = {
      autonomy: { default: input.defaultLevel, actions: input.actionLevels },
      limits: { daily: input.dailyLimits },
    };
    const [config] = await tx
      .update(agentConfigs)
      .set(values)
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.config_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType, ...values },
    });
  });
}

export const channelsInput = z.object({
  mailboxId: z.string().uuid().nullable().default(null),
  readMailbox: z.boolean().default(false),
  calendarId: z.string().uuid().nullable().default(null),
  crmConnectionId: z.string().uuid().nullable().default(null),
});

export async function saveAgentChannels(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  raw: z.input<typeof channelsInput>,
) {
  const channels: AgentChannels = channelsInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const ids = [channels.mailboxId, channels.calendarId].filter((x): x is string => Boolean(x));
    if (ids.length) {
      const found = await tx
        .select({ id: identities.id })
        .from(identities)
        .where(inArray(identities.id, ids));
      if (found.length !== ids.length) throw new Error("Buzón o calendario no encontrado.");
    }
    const [config] = await tx
      .update(agentConfigs)
      .set({ channels })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await syncProjectChannels(tx, tenant.orgId, projectId);
    await audit(tx, tenant, {
      event: "agent.channels_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType, ...channels },
    });
  });
}

const READ_CAPABILITIES = new Set(["email.list_messages", "email.get_message"]);

/**
 * The gateway and the agents check what a project may use through
 * project_identities / project_connections. Those links are derived from the
 * channels of the project's agents, so the user only configures agents.
 */
export async function syncProjectChannels(tx: Tx, orgId: string, projectId: string) {
  const agents = await tx
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.projectId, projectId), isNotNull(agentConfigs.addedAt)));
  const inbound = agents.find((a) => a.agentType === "inbound");
  const ordered = inbound ? [inbound, ...agents.filter((a) => a !== inbound)] : agents;

  const identityIds = [
    ...new Set(
      ordered.flatMap((a) => [a.channels.mailboxId, a.channels.calendarId]).filter((x): x is string => !!x),
    ),
  ];
  const readMailboxes = new Set(
    agents.filter((a) => a.channels.readMailbox && a.channels.mailboxId).map((a) => a.channels.mailboxId!),
  );
  const usedIdentities = identityIds.length
    ? await tx.select().from(identities).where(inArray(identities.id, identityIds))
    : [];

  // Connections in use, and whether any agent reads mail through them.
  const readsThrough = new Map<string, boolean>();
  for (const identity of usedIdentities) {
    if (!identity.connectionId) continue;
    readsThrough.set(
      identity.connectionId,
      (readsThrough.get(identity.connectionId) ?? false) || readMailboxes.has(identity.id),
    );
  }
  for (const a of agents) {
    if (a.channels.crmConnectionId && !readsThrough.has(a.channels.crmConnectionId)) {
      readsThrough.set(a.channels.crmConnectionId, false);
    }
  }
  const connectionRows = readsThrough.size
    ? await tx
        .select()
        .from(connections)
        .where(inArray(connections.id, [...readsThrough.keys()]))
    : [];

  await tx.delete(projectIdentities).where(eq(projectIdentities.projectId, projectId));
  await tx.delete(projectConnections).where(eq(projectConnections.projectId, projectId));

  // The first agent's mailbox and calendar (inbound first) are the project defaults.
  const defaults = new Set<string>();
  for (const kind of ["email", "calendar"] as const) {
    const first = identityIds.find((id) => usedIdentities.find((i) => i.id === id)?.kind === kind);
    if (first) defaults.add(first);
  }
  if (usedIdentities.length) {
    await tx
      .insert(projectIdentities)
      .values(
        usedIdentities.map((i) => ({ orgId, projectId, identityId: i.id, isDefault: defaults.has(i.id) })),
      );
  }
  if (connectionRows.length) {
    await tx.insert(projectConnections).values(
      connectionRows.map((c) => {
        let capabilities: string[] = [];
        try {
          capabilities = connectionCapabilities(c);
        } catch {
          capabilities = [];
        }
        if (!readsThrough.get(c.id)) capabilities = capabilities.filter((cap) => !READ_CAPABILITIES.has(cap));
        return { orgId, projectId, connectionId: c.id, capabilities };
      }),
    );
  }
}

/** Mailboxes, calendars and CRMs of the organization an agent can be pointed at. */
export async function listChannelOptions(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, async (tx) => {
    const conns = await tx.select().from(connections).orderBy(desc(connections.createdAt));
    const ids = await tx.select().from(identities);
    const byId = new Map(conns.map((c) => [c.id, c]));
    const withConn = ids.map((i) => ({
      ...i,
      connection: i.connectionId ? (byId.get(i.connectionId) ?? null) : null,
    }));
    return {
      mailboxes: withConn
        .filter((i) => i.kind === "email")
        .map((i) => ({
          id: i.id,
          address: i.address,
          canRead: i.connection?.readScopes.includes("email") ?? false,
          canSend: i.connection?.writeScopes.includes("email") ?? false,
        })),
      calendars: withConn
        .filter((i) => i.kind === "calendar")
        .map((i) => ({
          id: i.id,
          address: i.address,
          canBook: i.connection?.writeScopes.includes("calendar") ?? false,
        })),
      crms: conns
        .filter((c) => c.provider === "twenty")
        .map((c) => ({ id: c.id, label: c.label, canWrite: c.writeScopes.includes("crm") })),
    };
  });
}

// ---------------------------------------------------------------------------
// Instructions, schedule and tools (every agent)
// ---------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const instructionsInput = z.object({
  instructions: z.string().max(10_000).default(""),
  schedule: z
    .object({
      time: z.string().regex(TIME, "Hora no válida (HH:MM)."),
      days: z.array(z.number().int().min(1).max(7)).min(1, "Elige al menos un día."),
    })
    .nullable()
    .default(null),
  settings: z
    .object({
      prospectsPerRun: z.number().int().min(1).max(50).optional(),
      mode: z.enum(PROSPECTING_MODES).optional(),
      cellsPerRun: z.number().int().min(1).max(200).optional(),
    })
    .default({}),
});

export async function saveAgentInstructions(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  raw: z.input<typeof instructionsInput>,
) {
  const input = instructionsInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({
        instructions: input.instructions.trim() || null,
        schedule: input.schedule,
        settings: input.settings,
      })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.instructions_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType, schedule: input.schedule, settings: input.settings },
    });
  });
}

/** MCP servers of the organization, with the tools each one offers. */
export async function listMcpServers(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select()
      .from(connections)
      .where(eq(connections.provider, "mcp"))
      .orderBy(desc(connections.createdAt));
    return rows.map((c) => ({ id: c.id, label: c.label, status: c.status, tools: mcpToolsOf(c) }));
  });
}

/** B2B data providers (Apollo, Lusha) connected to the organization. */
export async function listDataSources(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select()
      .from(connections)
      .where(inArray(connections.provider, ["apollo", "lusha"]))
      .orderBy(desc(connections.createdAt));
    return rows.map((c) => ({ id: c.id, label: c.label, provider: c.provider, status: c.status }));
  });
}

export async function saveAgentTools(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  input: AgentTools,
) {
  const servers = await listMcpServers(db, tenant);
  // Keep only servers and tools that exist in this organization.
  const mcp = (input.mcp ?? [])
    .map((m) => {
      const server = servers.find((s) => s.id === m.connectionId);
      if (!server) return null;
      const names = new Set(server.tools.map((t) => t.name));
      return { connectionId: server.id, tools: m.tools.filter((t) => names.has(t)) };
    })
    .filter((m): m is { connectionId: string; tools: string[] } => Boolean(m && m.tools.length));
  const sources = await listDataSources(db, tenant);
  const data = (input.data ?? []).filter((id) => sources.some((s) => s.id === id));
  const tools: AgentTools = { web: Boolean(input.web), mcp, ...(data.length ? { data } : {}) };
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ tools })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.agentType, agentType)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.tools_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType, ...tools },
    });
  });
}

// ---------------------------------------------------------------------------
// Sales profile: what the project sells and to whom (shared by its agents)
// ---------------------------------------------------------------------------

export async function getSalesProfile(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .select({ salesProfile: projects.salesProfile })
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!row) throw new Error("Proyecto no encontrado.");
    return parseSalesProfile(row.salesProfile);
  });
}

export async function saveSalesProfile(db: Db, tenant: TenantContext, projectId: string, raw: unknown) {
  const profile = salesProfileSchema.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx
      .update(projects)
      .set({ salesProfile: profile })
      .where(eq(projects.id, projectId))
      .returning({ id: projects.id });
    if (!row) throw new Error("Proyecto no encontrado.");
    await audit(tx, tenant, {
      event: "project.sales_profile_updated",
      projectId,
      entityType: "project",
      entityId: projectId,
    });
    return profile;
  });
}

/** Latest runs of an agent, newest first (what it did and what it cost). */
export async function listAgentRuns(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  agentType: ProjectAgentType,
  limit = 5,
) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: agentRuns.id,
        trigger: agentRuns.trigger,
        status: agentRuns.status,
        summary: agentRuns.summary,
        error: agentRuns.error,
        costUsd: agentRuns.costUsd,
        startedAt: agentRuns.startedAt,
        finishedAt: agentRuns.finishedAt,
      })
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.agentType, agentType)))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit),
  );
}
