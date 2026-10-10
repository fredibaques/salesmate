import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AGENT_COLORS, AGENT_ICON_CHOICES } from "@/lib/agent-look";
import { agentName } from "@/lib/agents";
import { audit } from "../audit";
import { workingSql } from "../agents/working";
import { ensureAgentBaseIn } from "../prospects/bases";
import { mcpToolsOf } from "../connectors/mcp";
import { connectionCapabilities } from "../connectors/service";
import type { Db } from "../db/client";
import {
  actions,
  agentConfigs,
  agentRuns,
  connections,
  identities,
  projectConnections,
  projectIdentities,
  projects,
  PROSPECTING_MODES,
  type AgentChannels,
  type AgentSchedule,
  type AgentSettings,
  type AgentTools,
  type SalesMotion,
} from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { ensureProjectProcessIn, savePlaybookVersion } from "../playbooks/service";
import { PROCESS_FIELDS, parseSalesProfile, salesProfileSchema, type PlaybookSpec } from "../playbooks/spec";

/**
 * Agents are the unit the user works with: they add an agent to a project
 * and tell it what to do and which mailbox, calendar and CRM to use. The
 * sales process belongs to the project (playbooks/service.ts): the agents
 * that talk to people follow it; prospecting agents don't need it.
 */

/**
 * Agents a project can have, in the order of the sale: prospecting finds
 * and completes rows, outbound starts the conversation with them, inbound
 * attends who shows interest on their own. Others run at organization level.
 */
export const PROJECT_AGENT_TYPES = ["prospecting", "outbound", "inbound", "account_manager"] as const;
export type ProjectAgentType = (typeof PROJECT_AGENT_TYPES)[number];

/** Agents whose runtime exists today; the rest can't be added yet. */
export const AVAILABLE_AGENT_TYPES: readonly ProjectAgentType[] = ["prospecting", "outbound", "inbound"];

/** Starting configuration of each template; the user edits all of it. */
export const AGENT_DEFAULTS: Record<
  ProjectAgentType,
  { instructions: string; tools: AgentTools; schedule: AgentSchedule | null; settings: AgentSettings }
> = {
  prospecting: {
    instructions: [
      "Busca en fuentes públicas (webs de empresas, directorios, asociaciones del sector, noticias) empresas que encajen con nuestro cliente ideal.",
      "Para cada una, recoge el nombre, la web, la ciudad, un teléfono y un email de contacto públicos si los hay, y explica en una frase por qué encaja.",
      "No incluyas empresas que ya sean clientes ni las que estén fuera de nuestra zona.",
    ].join("\n"),
    tools: { web: true },
    schedule: { kind: "weekly", time: "08:00", days: [1, 2, 3, 4, 5] },
    settings: { prospectsPerRun: 10, mode: "both", cellsPerRun: 20 },
  },
  outbound: {
    instructions: [
      "Escribe un primer email breve y personal: menciona algo concreto de su empresa y por qué encaja, explica en una frase qué ofrecemos y termina con una pregunta fácil de responder.",
      "Nada de adjuntos ni de promesas que no estén en lo que sabemos.",
    ].join("\n"),
    tools: {},
    schedule: { kind: "weekly", time: "09:30", days: [1, 2, 3, 4, 5] },
    settings: { handoff: { enabled: true, minFit: 70, perRun: 5 } },
  },
  inbound: { instructions: "", tools: {}, schedule: null, settings: {} },
  account_manager: { instructions: "", tools: {}, schedule: null, settings: {} },
};

export function isProjectAgentType(value: string): value is ProjectAgentType {
  return (PROJECT_AGENT_TYPES as readonly string[]).includes(value);
}

async function findConfig(tx: Tx, projectId: string, agentId: string) {
  const [row] = await tx
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)));
  return row ?? null;
}

/** Kind order first, then the order they were added in. */
function byKindThenAdded<T extends { agentType: string; addedAt: Date | null }>(a: T, b: T) {
  const kind =
    PROJECT_AGENT_TYPES.indexOf(a.agentType as ProjectAgentType) -
    PROJECT_AGENT_TYPES.indexOf(b.agentType as ProjectAgentType);
  return kind || (a.addedAt?.getTime() ?? 0) - (b.addedAt?.getTime() ?? 0);
}

/** Agents added to a project (a project may have several of each kind). */
export async function listProjectAgents(db: Db, tenant: Pick<TenantContext, "orgId">, projectId: string) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select({ config: agentConfigs, working: workingSql })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.projectId, projectId), isNotNull(agentConfigs.addedAt)));
    return rows.sort((a, b) => byKindThenAdded(a.config, b.config));
  });
}

/** The added agents of every project, for the sidebar. */
export async function listSidebarAgents(db: Db, tenant: Pick<TenantContext, "orgId">) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: agentConfigs.id,
        projectId: agentConfigs.projectId,
        agentType: agentConfigs.agentType,
        name: agentConfigs.name,
        icon: agentConfigs.icon,
        color: agentConfigs.color,
        enabled: agentConfigs.enabled,
        addedAt: agentConfigs.addedAt,
        working: workingSql,
      })
      .from(agentConfigs)
      .where(isNotNull(agentConfigs.addedAt)),
  );
  return rows
    .filter((r): r is typeof r & { agentType: ProjectAgentType } => isProjectAgentType(r.agentType))
    .sort(byKindThenAdded);
}

/** One added agent of a project, by its id. */
export async function getAgent(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  agentId: string,
) {
  if (!UUID.test(agentId)) return null;
  const row = await withTenant(db, tenant, async (tx) => {
    const [found] = await tx
      .select({ config: agentConfigs, working: workingSql })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)));
    return found;
  });
  return row?.config.addedAt && isProjectAgentType(row.config.agentType) ? row : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Agents that talk to people and so follow the project's sales process. */
export const PROCESS_AGENT_TYPES: readonly ProjectAgentType[] = ["outbound", "inbound", "account_manager"];

/**
 * Adds an agent to a project: as many of each kind as the user wants. One
 * that talks to people gives the project a sales process from the template
 * of `salesMotion` if it has none yet. A second one of a kind is numbered
 * («Agente inbound 2») until the user names it.
 */
export async function addAgent(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentType: ProjectAgentType,
  salesMotion: SalesMotion = "b2b_consultative",
) {
  if (!AVAILABLE_AGENT_TYPES.includes(agentType)) throw new Error("Este agente todavía no está disponible.");
  return withTenant(db, tenant, async (tx) => {
    const siblings = await tx
      .select({ name: agentConfigs.name })
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.projectId, projectId),
          eq(agentConfigs.agentType, agentType),
          isNotNull(agentConfigs.addedAt),
        ),
      );
    const defaults = AGENT_DEFAULTS[agentType];
    const [config] = await tx
      .insert(agentConfigs)
      .values({
        orgId: tenant.orgId,
        projectId,
        agentType,
        name: siblings.length
          ? numberedName(
              agentType,
              siblings.map((s) => s.name),
            )
          : null,
        addedAt: new Date(),
        enabled: false,
        ...defaults,
        instructions: defaults.instructions || null,
      })
      .returning();
    if (PROCESS_AGENT_TYPES.includes(agentType))
      await ensureProjectProcessIn(tx, tenant, projectId, salesMotion);
    // A prospecting agent fills a base of the project from the start.
    if (agentType === "prospecting") await ensureAgentBaseIn(tx, tenant, config.id);
    await audit(tx, tenant, {
      event: "agent.added",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType },
    });
    return config;
  });
}

/** «Agente inbound 2», «… 3»: the first number no sibling uses. */
function numberedName(agentType: ProjectAgentType, taken: (string | null)[]) {
  const base = agentName(agentType, null);
  const used = new Set(taken.map((n) => n ?? base));
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Takes the agent out of the project. Its process is kept in case it is added again. */
export async function removeAgent(db: Db, tenant: TenantContext, projectId: string, agentId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ addedAt: null, enabled: false })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await syncProjectChannels(tx, tenant.orgId, projectId);
    await audit(tx, tenant, {
      event: "agent.removed",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType },
    });
  });
}

export async function setAgentEnabled(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  enabled: boolean,
) {
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ enabled })
      .where(
        and(
          eq(agentConfigs.projectId, projectId),
          eq(agentConfigs.id, agentId),
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
      data: { agentType: config.agentType },
    });
  });
}

/**
 * The agent's own name, icon and colour; an empty name (or an unknown icon
 * or colour) goes back to the template's.
 */
export async function customizeAgent(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  input: { name: string; icon?: string | null; color?: string | null },
) {
  const clean = input.name.trim().replace(/\s+/g, " ");
  if (clean.length > 60) throw new Error("El nombre puede tener hasta 60 caracteres.");
  const icon = input.icon && AGENT_ICON_CHOICES[input.icon] ? input.icon : null;
  const color = input.color && AGENT_COLORS[input.color] ? input.color : null;
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ name: clean || null, icon, color })
      .where(
        and(
          eq(agentConfigs.projectId, projectId),
          eq(agentConfigs.id, agentId),
          isNotNull(agentConfigs.addedAt),
        ),
      )
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.renamed",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType, name: config.name, icon, color },
    });
  });
}

/**
 * Saves a new version of the project's sales process (creating it if the
 * project has none); the fields of «Oferta y cliente» are left untouched.
 */
export async function saveProjectProcess(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  input: { salesMotion?: SalesMotion; process: Partial<PlaybookSpec>; notes?: string },
) {
  const current = await withTenant(db, tenant, (tx) =>
    ensureProjectProcessIn(tx, tenant, projectId, input.salesMotion ?? "b2b_consultative"),
  );
  const merged: Record<string, unknown> = { ...current.spec };
  for (const field of PROCESS_FIELDS) {
    if (field in input.process) merged[field] = input.process[field];
  }
  return savePlaybookVersion(db, tenant, current.id, {
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
  agentId: string,
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
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.config_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType, ...values },
    });
  });
}

export const channelsInput = z.object({
  mailboxId: z.string().uuid().nullable().default(null),
  readMailbox: z.boolean().default(false),
  calendarId: z.string().uuid().nullable().default(null),
  crmConnectionId: z.string().uuid().nullable().default(null),
  whatsappId: z.string().uuid().nullable().default(null),
});

export async function saveAgentChannels(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  raw: z.input<typeof channelsInput>,
) {
  const channels: AgentChannels = channelsInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const ids = [channels.mailboxId, channels.calendarId, channels.whatsappId].filter((x): x is string =>
      Boolean(x),
    );
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
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await syncProjectChannels(tx, tenant.orgId, projectId);
    await audit(tx, tenant, {
      event: "agent.channels_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType, ...channels },
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
      ordered
        .flatMap((a) => [a.channels.mailboxId, a.channels.calendarId, a.channels.whatsappId])
        .filter((x): x is string => !!x),
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
      whatsapps: withConn
        .filter((i) => i.kind === "whatsapp")
        .map((i) => ({ id: i.id, address: i.address, name: i.displayName })),
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

const scheduleInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), time: z.string().regex(TIME, "Hora no válida (HH:MM).") }),
  z.object({
    kind: z.literal("weekly"),
    time: z.string().regex(TIME, "Hora no válida (HH:MM)."),
    days: z.array(z.number().int().min(1).max(7)).min(1, "Elige al menos un día."),
  }),
  z.object({
    kind: z.literal("monthly"),
    time: z.string().regex(TIME, "Hora no válida (HH:MM)."),
    day: z.number().int().min(1, "Elige un día del mes.").max(31, "Elige un día del mes."),
  }),
  z.object({
    kind: z.literal("once"),
    at: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "Elige el día y la hora."),
  }),
]);

export const instructionsInput = z.object({
  instructions: z.string().max(10_000).default(""),
  /** null = only when someone asks. Without `kind`, weekly (as saved before there were others). */
  schedule: z
    .preprocess(
      (v) => (v && typeof v === "object" && !("kind" in v) ? { ...v, kind: "weekly" } : v),
      scheduleInput.nullable(),
    )
    .default(null),
  settings: z
    .object({
      prospectsPerRun: z.number().int().min(1).max(50).optional(),
      mode: z.enum(PROSPECTING_MODES).optional(),
      cellsPerRun: z.number().int().min(1).max(200).optional(),
      /** "" = the organization's model. */
      model: z.string().optional(),
    })
    .default({}),
});

export async function saveAgentInstructions(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  raw: z.input<typeof instructionsInput>,
) {
  const input = instructionsInput.parse(raw);
  return withTenant(db, tenant, async (tx) => {
    const current = await findConfig(tx, projectId, agentId);
    const [config] = await tx
      .update(agentConfigs)
      .set({
        instructions: input.instructions.trim() || null,
        schedule: input.schedule,
        // Only the per-run settings: the automation ones are saved apart.
        settings: { ...current?.settings, ...input.settings },
      })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.instructions_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType, schedule: input.schedule, settings: input.settings },
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
      .where(inArray(connections.provider, ["apollo", "lusha", "hunter", "serper"]))
      .orderBy(desc(connections.createdAt));
    return rows.map((c) => ({ id: c.id, label: c.label, provider: c.provider, status: c.status }));
  });
}

export async function saveAgentTools(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
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
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)))
      .returning();
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.tools_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType, ...tools },
    });
  });
}

/** One tool an agent uses: the web, a data provider or an MCP server (by connection). */
export type AgentToolKey = "web" | `data:${string}` | `mcp:${string}`;

async function currentTools(db: Db, tenant: TenantContext, projectId: string, agentId: string) {
  const agent = await getAgent(db, tenant, projectId, agentId);
  if (!agent) throw new Error("Agente no encontrado.");
  return agent.config.tools;
}

/** Gives the agent a tool; an MCP server comes with all its functions. */
export async function addAgentTool(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  key: AgentToolKey,
) {
  const tools = await currentTools(db, tenant, projectId, agentId);
  if (key === "web") return saveAgentTools(db, tenant, projectId, agentId, { ...tools, web: true });
  const [kind, id] = key.split(":") as ["data" | "mcp", string];
  if (kind === "data") {
    if (!(await listDataSources(db, tenant)).some((s) => s.id === id))
      throw new Error("Conexión no encontrada.");
    return saveAgentTools(db, tenant, projectId, agentId, {
      ...tools,
      data: [...new Set([...(tools.data ?? []), id])],
    });
  }
  const server = (await listMcpServers(db, tenant)).find((s) => s.id === id);
  if (!server) throw new Error("Servidor MCP no encontrado.");
  if (!server.tools.length)
    throw new Error(
      "Este servidor no ofrece herramientas. Pulsa «Probar conexión» en Integraciones para actualizarlo.",
    );
  return saveAgentTools(db, tenant, projectId, agentId, {
    ...tools,
    mcp: [
      ...(tools.mcp ?? []).filter((m) => m.connectionId !== id),
      { connectionId: id, tools: server.tools.map((t) => t.name) },
    ],
  });
}

export async function removeAgentTool(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  key: AgentToolKey,
) {
  const tools = await currentTools(db, tenant, projectId, agentId);
  if (key === "web") return saveAgentTools(db, tenant, projectId, agentId, { ...tools, web: false });
  const [kind, id] = key.split(":");
  return saveAgentTools(db, tenant, projectId, agentId, {
    ...tools,
    data: kind === "data" ? (tools.data ?? []).filter((d) => d !== id) : tools.data,
    mcp: kind === "mcp" ? (tools.mcp ?? []).filter((m) => m.connectionId !== id) : tools.mcp,
  });
}

/** Which functions of an MCP server the agent may call. */
export async function setAgentMcpTools(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  connectionId: string,
  names: string[],
) {
  if (!names.length) throw new Error("Elige al menos una función. Para que no lo use, quita la herramienta.");
  const tools = await currentTools(db, tenant, projectId, agentId);
  return saveAgentTools(db, tenant, projectId, agentId, {
    ...tools,
    mcp: [
      ...(tools.mcp ?? []).filter((m) => m.connectionId !== connectionId),
      { connectionId, tools: names },
    ],
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
  agentId: string,
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
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.agentConfigId, agentId)))
      .orderBy(desc(agentRuns.startedAt))
      .limit(limit),
  );
}

// ---------------------------------------------------------------------------
// Automation: triggers, caps, goal, sources, notices and the next step
// ---------------------------------------------------------------------------

/** «example.com», «https://www.example.com/x» → «example.com»; null when it isn't a domain. */
export function cleanDomain(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  try {
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/** A new secret for an agent's webhook URL. */
export function newHookToken(): string {
  return randomBytes(24).toString("base64url");
}

const money = z.number().min(0.01, "El límite debe ser mayor que 0.").max(10_000);

export const automationInput = z.object({
  triggers: z.object({ newRows: z.boolean().default(false), webhook: z.boolean().default(false) }).default({
    newRows: false,
    webhook: false,
  }),
  budget: z
    .object({
      maxCostPerRunUsd: money.optional(),
      maxCostPerMonthUsd: money.optional(),
      maxSearchesPerRun: z.number().int().min(1).max(500).optional(),
    })
    .default({}),
  goal: z
    .object({
      rows: z.number().int().min(1).max(100_000),
      minFit: z.number().int().min(0).max(100).optional(),
    })
    .nullable()
    .default(null),
  sources: z
    .object({
      allow: z.array(z.string()).default([]),
      block: z.array(z.string()).default([]),
      prefer: z.enum(["data", "web"]).nullable().default(null),
    })
    .default({ allow: [], block: [], prefer: null }),
  notify: z
    .object({
      slackConnectionId: z.string().uuid().nullable().default(null),
      emails: z.array(z.string().email("Revisa los emails de aviso.")).max(20).default([]),
      onFinish: z.boolean().default(false),
      onProblem: z.boolean().default(false),
    })
    .default({ slackConnectionId: null, emails: [], onFinish: false, onProblem: false }),
  /** Mailbox it writes from (first contacts and email notices). */
  mailboxId: z.string().uuid().nullable().default(null),
  handoff: z
    .object({
      enabled: z.boolean().default(false),
      minFit: z.number().int().min(0).max(100).optional(),
      perRun: z.number().int().min(1).max(25).optional(),
      instructions: z.string().max(4000).optional(),
    })
    .default({ enabled: false }),
});

/**
 * Saves what makes the agent work besides its schedule, its caps and goal,
 * where it may look, whom it tells and its next step. A webhook gets its
 * secret the first time it is turned on and keeps it.
 */
export async function saveAgentAutomation(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  raw: z.input<typeof automationInput>,
) {
  const input = automationInput.parse(raw);
  const domains = (list: string[]) => {
    const bad = list.filter((d) => d.trim() && !cleanDomain(d));
    if (bad.length) throw new Error(`No parecen dominios: ${bad.join(", ")}.`);
    return [...new Set(list.map(cleanDomain).filter((d): d is string => Boolean(d)))];
  };
  const sources = { allow: domains(input.sources.allow), block: domains(input.sources.block) };
  if (input.handoff.enabled && !input.mailboxId)
    throw new Error("Elige el buzón desde el que escribirá los primeros emails.");
  if (input.notify.emails.length && !input.mailboxId)
    throw new Error("Elige el buzón desde el que enviará los avisos por email.");

  return withTenant(db, tenant, async (tx) => {
    const current = await findConfig(tx, projectId, agentId);
    if (!current?.addedAt) throw new Error("Agente no encontrado.");
    if (input.notify.slackConnectionId) {
      const [slack] = await tx
        .select({ id: connections.id })
        .from(connections)
        .where(and(eq(connections.id, input.notify.slackConnectionId), eq(connections.provider, "slack")));
      if (!slack) throw new Error("Conexión de Slack no encontrada.");
    }
    if (input.mailboxId) {
      const [mailbox] = await tx
        .select({ id: identities.id })
        .from(identities)
        .where(and(eq(identities.id, input.mailboxId), eq(identities.kind, "email")));
      if (!mailbox) throw new Error("Buzón no encontrado.");
    }
    const settings: AgentSettings = {
      ...current.settings,
      triggers: input.triggers,
      budget: input.budget,
      goal: input.goal ?? undefined,
      sources: { ...sources, ...(input.sources.prefer ? { prefer: input.sources.prefer } : {}) },
      notify: input.notify,
      handoff: input.handoff,
    };
    const hookToken = input.triggers.webhook ? (current.hookToken ?? newHookToken()) : current.hookToken;
    const [config] = await tx
      .update(agentConfigs)
      .set({
        settings,
        hookToken,
        channels: { ...current.channels, mailboxId: input.mailboxId },
      })
      .where(eq(agentConfigs.id, current.id))
      .returning();
    await syncProjectChannels(tx, tenant.orgId, projectId);
    await audit(tx, tenant, {
      event: "agent.automation_updated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType, ...settings, mailboxId: input.mailboxId },
    });
  });
}

/**
 * What makes an agent work besides «Ejecutar ahora» and its schedule: new
 * rows of its table, a notice to its webhook (which gets its secret URL the
 * first time) and, for the inbound agent, its project's web form.
 */
export async function saveAgentTriggers(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  triggers: { newRows: boolean; webhook: boolean; form?: boolean },
) {
  return withTenant(db, tenant, async (tx) => {
    const current = await findConfig(tx, projectId, agentId);
    if (!current?.addedAt) throw new Error("Agente no encontrado.");
    const settings: AgentSettings = {
      ...current.settings,
      triggers: { ...current.settings.triggers, ...triggers },
    };
    const hookToken = triggers.webhook ? (current.hookToken ?? newHookToken()) : current.hookToken;
    await tx.update(agentConfigs).set({ settings, hookToken }).where(eq(agentConfigs.id, current.id));
    await audit(tx, tenant, {
      event: "agent.triggers_updated",
      projectId,
      entityType: "agent_config",
      entityId: current.id,
      data: { agentType: current.agentType, triggers },
    });
  });
}

/**
 * Whom the outbound agent writes to and from where: rows of its table with
 * at least `minFit`, up to `perRun` a run, from the mailbox `mailboxId`.
 */
export async function saveAgentOutreach(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentId: string,
  input: { minFit: number; perRun: number; mailboxId: string | null },
) {
  const minFit = Math.max(0, Math.min(100, Math.round(input.minFit)));
  const perRun = Math.max(1, Math.min(25, Math.round(input.perRun)));
  return withTenant(db, tenant, async (tx) => {
    const current = await findConfig(tx, projectId, agentId);
    if (!current?.addedAt) throw new Error("Agente no encontrado.");
    if (input.mailboxId) {
      const [mailbox] = await tx
        .select({ id: identities.id })
        .from(identities)
        .where(and(eq(identities.id, input.mailboxId), eq(identities.kind, "email")));
      if (!mailbox) throw new Error("Buzón no encontrado.");
    }
    const settings: AgentSettings = {
      ...current.settings,
      handoff: { ...current.settings.handoff, enabled: true, minFit, perRun },
    };
    await tx
      .update(agentConfigs)
      .set({ settings, channels: { ...current.channels, mailboxId: input.mailboxId } })
      .where(eq(agentConfigs.id, current.id));
    await syncProjectChannels(tx, tenant.orgId, projectId);
    await audit(tx, tenant, {
      event: "agent.outreach_updated",
      projectId,
      entityType: "agent_config",
      entityId: current.id,
      data: { agentType: current.agentType, minFit, perRun, mailboxId: input.mailboxId },
    });
  });
}

/** A new webhook secret: the old URL stops working. */
export async function rotateAgentHook(db: Db, tenant: TenantContext, projectId: string, agentId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [config] = await tx
      .update(agentConfigs)
      .set({ hookToken: newHookToken() })
      .where(and(eq(agentConfigs.projectId, projectId), eq(agentConfigs.id, agentId)))
      .returning({ id: agentConfigs.id, agentType: agentConfigs.agentType });
    if (!config) throw new Error("Agente no encontrado.");
    await audit(tx, tenant, {
      event: "agent.hook_rotated",
      projectId,
      entityType: "agent_config",
      entityId: config.id,
      data: { agentType: config.agentType },
    });
  });
}

/** Slack channels connected to the organization, for notices. */
export async function listSlackConnections(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select({ id: connections.id, label: connections.label, status: connections.status })
      .from(connections)
      .where(eq(connections.provider, "slack"))
      .orderBy(desc(connections.createdAt)),
  );
}

/** First emails a prospecting agent proposed that wait for a person. */
export async function firstEmailsWaiting(db: Db, tenant: Pick<TenantContext, "orgId">, agentId: string) {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(actions)
      .where(
        and(
          eq(actions.agentConfigId, agentId),
          eq(actions.type, "email.send"),
          eq(actions.status, "pending_approval"),
        ),
      ),
  );
  return Number(row?.n ?? 0);
}
