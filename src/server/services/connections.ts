import { eq, inArray } from "drizzle-orm";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { agentConfigs, connections, identities, type AgentSettings } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
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

    if (gone.size) await tx.delete(identities).where(inArray(identities.id, [...gone]));
    await tx.delete(connections).where(eq(connections.id, connectionId));
    // What each project may use is derived from its agents' channels.
    const projects = new Set(agents.map((a) => a.projectId));
    for (const projectId of projects) await syncProjectChannels(tx, tenant.orgId, projectId);

    await audit(tx, tenant, {
      event: "connection.removed",
      entityType: "connection",
      entityId: connectionId,
      data: { provider: connection.provider, label: connection.label, identities: gone.size },
    });
    return { provider: connection.provider, label: connection.label };
  });
}
