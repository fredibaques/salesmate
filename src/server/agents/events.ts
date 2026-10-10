import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  agentConfigs,
  agentEvents,
  agentRuns,
  inboundEvents,
  projects,
  prospectBases,
  prospects,
  type AgentEventKind,
} from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import type { LlmClient } from "../llm/client";
import { runOutreach, type OutreachResult } from "./outreach";
import { runProspecting, type AgentRunDeps, type ProspectingResult } from "./prospector";

/**
 * Event triggers: besides its schedule and «Ejecutar ahora», an agent works
 * when something happens. Events are stored first (agent_events) and then
 * processed: right away when possible, otherwise by the scheduler's next
 * pass (the agent was busy, or the process was cut off).
 */

/** Pending events kept per agent; beyond this, new ones are dropped. */
const MAX_PENDING = 50;
/** Events handled by one run. */
const EVENTS_PER_RUN = 20;
/** A run still "running" after this long is not blocking anything. */
const BUSY_MS = 10 * 60_000;

const TRIGGER_FOR: Record<AgentEventKind, "newRows" | "webhook"> = {
  new_rows: "newRows",
  webhook: "webhook",
};

/**
 * Stores an event for the agent if it listens to that kind (its trigger is
 * on). Returns whether it was stored.
 */
export async function recordAgentEvent(
  db: AgentRunDeps["db"],
  tenant: { orgId: string },
  input: { agentConfigId: string; kind: AgentEventKind; payload: Record<string, unknown> },
): Promise<boolean> {
  return withTenant(db, tenant, async (tx) => {
    const [agent] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, input.agentConfigId));
    if (!agent?.addedAt || !agent.settings.triggers?.[TRIGGER_FOR[input.kind]]) return false;
    const [pending] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(agentEvents)
      .where(and(eq(agentEvents.agentConfigId, agent.id), isNull(agentEvents.processedAt)));
    if (Number(pending?.n ?? 0) >= MAX_PENDING) return false;
    await tx.insert(agentEvents).values({
      orgId: tenant.orgId,
      projectId: agent.projectId,
      agentConfigId: agent.id,
      kind: input.kind,
      payload: input.payload,
    });
    return true;
  });
}

/**
 * Who works on rows just added to a table: the agents that run on them
 * (prospecting completes them, outbound writes to them) and the inbound
 * agents that attend them as leads.
 */
export type RowsAddedTo = { prospecting: string[]; inbound: string[] };

/**
 * Rows a person (or a form) added to a table. The agents working on it that
 * listen to new rows get them: the prospecting agent completes them (an
 * agent event), the inbound agent attends each person as a new lead.
 */
export async function rowsAdded(
  db: AgentRunDeps["db"],
  tenant: { orgId: string },
  input: { baseId: string; rowIds: string[] },
): Promise<RowsAddedTo> {
  const out: RowsAddedTo = { prospecting: [], inbound: [] };
  if (!input.rowIds.length) return out;
  const agents = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: agentConfigs.id,
        agentType: agentConfigs.agentType,
        projectId: agentConfigs.projectId,
        settings: agentConfigs.settings,
        enabled: agentConfigs.enabled,
      })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.prospectBaseId, input.baseId), isNotNull(agentConfigs.addedAt))),
  );
  for (const agent of agents) {
    if (agent.agentType === "inbound") {
      if (!agent.settings.triggers?.newRows) continue;
      if (await queueRowsAsLeads(db, tenant, { ...input, projectId: agent.projectId, agentId: agent.id })) {
        out.inbound.push(agent.id);
      }
      continue;
    }
    if (
      await recordAgentEvent(db, tenant, {
        agentConfigId: agent.id,
        kind: "new_rows",
        payload: { rowIds: input.rowIds },
      })
    )
      out.prospecting.push(agent.id);
  }
  return out;
}

/** The fields of a table row as a lead (name, company, email, phone and the other columns by name). */
function rowAsFields(
  row: typeof prospects.$inferSelect,
  columns: (typeof prospectBases.$inferSelect)["columns"],
): Record<string, string> {
  const fields: Record<string, string> = {};
  if (row.personName) fields.nombre = row.personName;
  if (row.companyName) fields.empresa = row.companyName;
  if (row.website) fields.web = row.website;
  for (const c of columns) {
    const value = row.data[c.id];
    if (value === null || value === undefined || value === "") continue;
    const key = c.type === "email" ? "email" : c.type === "phone" ? "telefono" : c.name;
    if (!(key in fields)) fields[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return fields;
}

/** Rows of a table queued as leads of an inbound agent (those with an email or a phone). */
async function queueRowsAsLeads(
  db: AgentRunDeps["db"],
  tenant: { orgId: string },
  input: { baseId: string; rowIds: string[]; projectId: string; agentId: string },
) {
  return withTenant(db, tenant, async (tx) => {
    const [base] = await tx.select().from(prospectBases).where(eq(prospectBases.id, input.baseId));
    if (!base) return 0;
    const rows = await tx.select().from(prospects).where(inArray(prospects.id, input.rowIds));
    const events = rows
      .map((row) => ({ row, fields: rowAsFields(row, base.columns) }))
      .filter(({ fields }) => fields.email || fields.telefono)
      .map(({ row, fields }) => ({
        orgId: tenant.orgId,
        projectId: input.projectId,
        agentConfigId: input.agentId,
        source: "table",
        eventType: "table.row_added",
        // Per agent: two inbound agents on the same table each attend the row.
        externalId: `row:${row.id}:${input.agentId}`,
        payload: { fields, rowId: row.id, baseId: base.id },
      }));
    if (!events.length) return 0;
    await tx.insert(inboundEvents).values(events).onConflictDoNothing();
    return events.length;
  });
}

/** The agent behind a webhook token (any organization), or null. */
export async function agentByHookToken(db: AgentRunDeps["db"], token: string) {
  if (token.length < 20) return null;
  const [agent] = await withSystem(db, (tx) =>
    tx
      .select({
        id: agentConfigs.id,
        orgId: agentConfigs.orgId,
        projectId: agentConfigs.projectId,
        agentType: agentConfigs.agentType,
        settings: agentConfigs.settings,
      })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.hookToken, token), isNotNull(agentConfigs.addedAt))),
  );
  return agent ?? null;
}

export type EventRunOutcome =
  | { status: "ran"; result: ProspectingResult | OutreachResult; events: number }
  | { status: "idle" | "busy" | "paused" };

/**
 * Runs the agent on its pending events, if it can work now: it is active,
 * its project isn't paused and it isn't already working. The events are
 * claimed first, so two calls never handle the same ones.
 */
export async function processAgentEvents(
  deps: AgentRunDeps,
  tenant: { orgId: string },
  agentConfigId: string,
): Promise<EventRunOutcome> {
  const now = deps.now?.() ?? new Date();
  const state = await withTenant(deps.db, tenant, async (tx) => {
    const [row] = await tx
      .select({ agent: agentConfigs, project: projects })
      .from(agentConfigs)
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(eq(agentConfigs.id, agentConfigId));
    if (!row?.agent.addedAt || !row.agent.enabled || row.project.agentsPaused) return null;
    const [last] = await tx
      .select({ status: agentRuns.status, startedAt: agentRuns.startedAt })
      .from(agentRuns)
      .where(eq(agentRuns.agentConfigId, row.agent.id))
      .orderBy(desc(agentRuns.startedAt))
      .limit(1);
    const busy = last?.status === "running" && now.getTime() - last.startedAt.getTime() < BUSY_MS;
    return { agent: row.agent, busy };
  });
  if (!state) return { status: "paused" };
  if (state.busy) return { status: "busy" };

  const claimed = await withTenant(deps.db, tenant, async (tx) => {
    const ids = await tx
      .select({ id: agentEvents.id })
      .from(agentEvents)
      .where(and(eq(agentEvents.agentConfigId, agentConfigId), isNull(agentEvents.processedAt)))
      .orderBy(asc(agentEvents.createdAt))
      .limit(EVENTS_PER_RUN);
    if (!ids.length) return [];
    return tx
      .update(agentEvents)
      .set({ processedAt: now })
      .where(
        and(
          inArray(
            agentEvents.id,
            ids.map((r) => r.id),
          ),
          isNull(agentEvents.processedAt),
        ),
      )
      .returning();
  });
  if (!claimed.length) return { status: "idle" };

  const triggerRef = [...new Set(claimed.map((e) => e.kind))].join(",");
  if (state.agent.agentType === "outbound") {
    const outreach = await runOutreach(deps, tenant, {
      agentId: state.agent.id,
      trigger: "event",
      triggerRef,
    });
    await withTenant(deps.db, tenant, (tx) =>
      tx
        .update(agentEvents)
        .set({ runId: outreach.runId })
        .where(
          inArray(
            agentEvents.id,
            claimed.map((e) => e.id),
          ),
        ),
    );
    return { status: "ran", result: outreach, events: claimed.length };
  }
  const result = await runProspecting(deps, tenant, {
    agentId: state.agent.id,
    trigger: "event",
    triggerRef,
    events: claimed.map((e) => ({ kind: e.kind, payload: e.payload })),
  });
  await withTenant(deps.db, tenant, (tx) =>
    tx
      .update(agentEvents)
      .set({ runId: result.runId })
      .where(
        inArray(
          agentEvents.id,
          claimed.map((e) => e.id),
        ),
      ),
  );
  return { status: "ran", result, events: claimed.length };
}

/** Agents with pending events that may work now, across organizations (scheduler). */
export async function agentsWithPendingEvents(db: AgentRunDeps["db"]) {
  return withSystem(db, (tx) =>
    tx
      .selectDistinct({ agentConfigId: agentEvents.agentConfigId, orgId: agentEvents.orgId })
      .from(agentEvents)
      .innerJoin(agentConfigs, eq(agentConfigs.id, agentEvents.agentConfigId))
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(
        and(
          isNull(agentEvents.processedAt),
          eq(agentConfigs.enabled, true),
          isNotNull(agentConfigs.addedAt),
          eq(projects.agentsPaused, false),
        ),
      ),
  );
}

/** Processes pending events of every agent (scheduler pass), up to `limit` runs. */
export async function runPendingEvents(
  deps: Omit<AgentRunDeps, "llm"> & { llmFor: (orgId: string) => Promise<LlmClient | null> },
  options: { limit?: number } = {},
) {
  const pending = await agentsWithPendingEvents(deps.db);
  // In parallel, like scheduled runs: each has its own time budget.
  return Promise.all(
    pending.slice(0, options.limit ?? 2).map(async ({ agentConfigId, orgId }) => {
      const llm = await deps.llmFor(orgId);
      if (!llm) return { agentConfigId, outcome: "no_ai" as const };
      const outcome = await processAgentEvents({ ...deps, llm }, { orgId }, agentConfigId);
      return { agentConfigId, outcome: outcome.status };
    }),
  );
}

/**
 * A notice posted to an inbound agent's webhook, queued as its lead: its
 * top-level values by name (nombre, email, telefono, mensaje…). Without an
 * email or a phone there is no one to attend.
 */
export async function queueWebhookLead(
  db: AgentRunDeps["db"],
  tenant: { orgId: string },
  agent: { id: string; projectId: string },
  body: unknown,
) {
  const source =
    body && typeof body === "object" && !Array.isArray(body)
      ? ((body as Record<string, unknown>).fields ?? body)
      : { mensaje: String(body ?? "") };
  const fields = Object.fromEntries(
    Object.entries(source as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
      .map(([k, v]) => [k, String(v)]),
  );
  const keys = Object.keys(fields).map((k) => k.toLowerCase());
  if (!keys.some((k) => /mail|tel|phone|movil|móvil|whatsapp/.test(k))) return false;
  await withTenant(db, tenant, (tx) =>
    tx.insert(inboundEvents).values({
      orgId: tenant.orgId,
      projectId: agent.projectId,
      agentConfigId: agent.id,
      source: "webhook",
      eventType: "webhook.received",
      payload: { fields },
    }),
  );
  return true;
}
