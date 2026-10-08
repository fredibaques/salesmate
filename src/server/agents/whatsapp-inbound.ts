import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { agentConfigs, connections, identities, inboundEvents } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import { decryptJson } from "../crypto";
import { whatsappCredentials, type WhatsappCredentials, type WhatsappMessage } from "../connectors/whatsapp";
import type { WhatsappInboundPayload } from "./leads";

/**
 * Messages that reach a connected WhatsApp Business number become inbound
 * events of the project whose inbound agent answers from that number, so
 * they follow the same path as forms and emails.
 */

/** The WhatsApp connection behind a webhook URL, with its credentials; null if there is none. */
export async function whatsappConnection(
  db: Db,
  connectionId: string,
): Promise<{ id: string; orgId: string; creds: WhatsappCredentials } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return null;
  const [row] = await withSystem(db, (tx) =>
    tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1),
  );
  if (!row || row.provider !== "whatsapp" || !row.credentialsEncrypted) return null;
  const creds = whatsappCredentials.safeParse(decryptJson(row.credentialsEncrypted));
  return creds.success ? { id: row.id, orgId: row.orgId, creds: creds.data } : null;
}

/**
 * Queues the messages for the project that attends that number. Returns the
 * new events (repeated deliveries of the same message are skipped) and why
 * nothing was queued, if so.
 */
export async function queueWhatsappMessages(
  db: Db,
  connection: { id: string; orgId: string },
  messages: WhatsappMessage[],
): Promise<{ eventIds: string[]; reason?: "no_identity" | "no_project" }> {
  if (!messages.length) return { eventIds: [] };
  const tenant = { orgId: connection.orgId };
  return withTenant(db, tenant, async (tx) => {
    const [identity] = await tx
      .select()
      .from(identities)
      .where(and(eq(identities.connectionId, connection.id), eq(identities.kind, "whatsapp")));
    if (!identity) return { eventIds: [], reason: "no_identity" as const };
    const [agent] = await tx
      .select({ projectId: agentConfigs.projectId })
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.agentType, "inbound"),
          isNotNull(agentConfigs.addedAt),
          sql`${agentConfigs.channels}->>'whatsappId' = ${identity.id}`,
        ),
      )
      .limit(1);
    if (!agent) return { eventIds: [], reason: "no_project" as const };
    const ids = messages.map((m) => m.id).filter(Boolean);
    const seen = new Set(
      ids.length
        ? (
            await tx
              .select({ externalId: inboundEvents.externalId })
              .from(inboundEvents)
              .where(and(eq(inboundEvents.source, "whatsapp"), inArray(inboundEvents.externalId, ids)))
          ).map((r) => r.externalId)
        : [],
    );
    const eventIds: string[] = [];
    for (const m of messages) {
      if (m.id && seen.has(m.id)) continue;
      const payload: WhatsappInboundPayload = {
        id: m.id,
        from: m.from,
        name: m.name,
        text: m.text,
        number: identity.address,
      };
      const [event] = await tx
        .insert(inboundEvents)
        .values({
          orgId: connection.orgId,
          projectId: agent.projectId,
          connectionId: connection.id,
          source: "whatsapp",
          eventType: "whatsapp.message",
          externalId: m.id || null,
          payload,
        })
        .returning({ id: inboundEvents.id });
      eventIds.push(event.id);
    }
    return { eventIds };
  });
}
