import { and, eq, inArray } from "drizzle-orm";
import { GOOGLE_TOOLS, googleToolsOf, type GoogleTool } from "@/lib/integrations";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { agentConfigs, connections, identities, type AgentSettings } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { syncProjectChannels } from "./agents";

/**
 * Disconnects a tool from the organization: the connection, its mailboxes
 * and calendars, and every reference the agents had to them (their
 * channels, tools and notices), so nothing keeps pointing at it. Actions
 * and knowledge that used it keep their history (their link is cleared).
 * The access granted at the provider (e.g. Google) stays until the person
 * removes it there.
 */
export async function removeConnection(db: Db, tenant: TenantContext, connectionId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [connection] = await tx.select().from(connections).where(eq(connections.id, connectionId));
    if (!connection) throw new Error("Integración no encontrada.");
    const gone = new Set(
      (
        await tx
          .select({ id: identities.id })
          .from(identities)
          .where(eq(identities.connectionId, connectionId))
      ).map((i) => i.id),
    );

    await detachFromAgents(tx, { identityIds: gone, connectionId });
    if (gone.size) await tx.delete(identities).where(inArray(identities.id, [...gone]));
    await tx.delete(connections).where(eq(connections.id, connectionId));
    await resyncProjects(tx, tenant.orgId);

    await audit(tx, tenant, {
      event: "connection.removed",
      entityType: "connection",
      entityId: connectionId,
      data: { provider: connection.provider, label: connection.label, identities: gone.size },
    });
    return { provider: connection.provider, label: connection.label };
  });
}

/**
 * Takes away from every agent the mailboxes, calendars and numbers that are
 * gone and, with `connectionId`, the connection itself (CRM, data and MCP
 * tools, Slack notices).
 */
async function detachFromAgents(
  tx: Tx,
  { identityIds: gone, connectionId: only }: { identityIds: Set<string>; connectionId?: string },
) {
  // No connection to forget: an id no agent can point at.
  const connectionId = only ?? "-";
  const agents = await tx.select().from(agentConfigs);
  for (const agent of agents) {
    const { channels, tools } = agent;
    const settings: AgentSettings = agent.settings;
    const uses =
      [channels.mailboxId, channels.calendarId, channels.whatsappId].some((id) => id && gone.has(id)) ||
      channels.crmConnectionId === connectionId ||
      Boolean(tools.data?.includes(connectionId)) ||
      Boolean(tools.mcp?.some((m) => m.connectionId === connectionId)) ||
      settings.notify?.slackConnectionId === connectionId;
    if (!uses) continue;
    const clear = (id: string | null | undefined) => (id && gone.has(id) ? null : (id ?? null));
    const mailboxId = clear(channels.mailboxId);
    await tx
      .update(agentConfigs)
      .set({
        channels: {
          ...channels,
          mailboxId,
          readMailbox: mailboxId ? channels.readMailbox : false,
          calendarId: clear(channels.calendarId),
          whatsappId: clear(channels.whatsappId),
          crmConnectionId: channels.crmConnectionId === connectionId ? null : channels.crmConnectionId,
        },
        tools: {
          ...tools,
          ...(tools.data ? { data: tools.data.filter((id) => id !== connectionId) } : {}),
          ...(tools.mcp ? { mcp: tools.mcp.filter((m) => m.connectionId !== connectionId) } : {}),
        },
        settings:
          settings.notify?.slackConnectionId === connectionId
            ? { ...settings, notify: { ...settings.notify, slackConnectionId: null } }
            : settings,
      })
      .where(eq(agentConfigs.id, agent.id));
  }
}

/** What each project may use is derived from its agents' channels. */
async function resyncProjects(tx: Tx, orgId: string) {
  const rows = await tx.selectDistinct({ projectId: agentConfigs.projectId }).from(agentConfigs);
  for (const { projectId } of rows) await syncProjectChannels(tx, orgId, projectId);
}

/**
 * Turns off one Google tool of an account (Gmail, Calendar…): the
 * connection stops using its scopes and its mailbox or calendar goes, the
 * other tools stay. The last one off removes the connection.
 */
export async function removeGoogleTool(
  db: Db,
  tenant: TenantContext,
  connectionId: string,
  tool: GoogleTool,
) {
  const [connection] = await withTenant(db, tenant, (tx) =>
    tx.select().from(connections).where(eq(connections.id, connectionId)),
  );
  if (!connection || connection.provider !== "google") throw new Error("Integración no encontrada.");
  const scope = GOOGLE_TOOLS[tool].scope as string;
  const read = connection.readScopes.filter((x) => x !== scope);
  const write = connection.writeScopes.filter((x) => x !== scope);
  if (googleToolsOf(read, write).length === 0) return removeConnection(db, tenant, connectionId);
  return withTenant(db, tenant, async (tx) => {
    const kind = tool === "gmail" ? "email" : tool === "google_calendar" ? "calendar" : null;
    const gone = new Set(
      kind
        ? (
            await tx
              .select({ id: identities.id })
              .from(identities)
              .where(and(eq(identities.connectionId, connectionId), eq(identities.kind, kind)))
          ).map((i) => i.id)
        : [],
    );
    await detachFromAgents(tx, { identityIds: gone });
    if (gone.size) await tx.delete(identities).where(inArray(identities.id, [...gone]));
    await tx
      .update(connections)
      .set({ readScopes: read, writeScopes: write })
      .where(eq(connections.id, connectionId));
    await resyncProjects(tx, tenant.orgId);
    await audit(tx, tenant, {
      event: "connection.tool_removed",
      entityType: "connection",
      entityId: connectionId,
      data: { provider: "google", tool, label: connection.label },
    });
    return { provider: "google", label: `${GOOGLE_TOOLS[tool].name} · ${connection.accountRef}` };
  });
}
