import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { verifyTwentyWebhook, twentyCredentials } from "@/server/connectors/twenty";
import { decryptJson } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { connections, inboundEvents } from "@/server/db/schema";
import { withSystem, withTenant } from "@/server/db/tenant";

/**
 * Receives Twenty webhooks for one connection. The organization is resolved
 * from the connection id in the URL; the signature proves the sender knows
 * that connection's webhook secret. Events are queued for the agents.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/twenty/[connectionId]">) {
  const { connectionId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(connectionId))
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = getDb();
  const [connection] = await withSystem(db, (tx) =>
    tx.select().from(connections).where(eq(connections.id, connectionId)).limit(1),
  );
  if (!connection || connection.provider !== "twenty" || !connection.credentialsEncrypted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const creds = twentyCredentials.parse(decryptJson(connection.credentialsEncrypted));
  const rawBody = await request.text();
  if (
    !creds.webhookSecret ||
    !verifyTwentyWebhook({
      secret: creds.webhookSecret,
      rawBody,
      signature: request.headers.get("x-twenty-webhook-signature"),
      timestamp: request.headers.get("x-twenty-webhook-timestamp"),
    })
  ) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let body: { event?: string; eventName?: string; data?: unknown; record?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  await withTenant(db, { orgId: connection.orgId }, (tx) =>
    tx.insert(inboundEvents).values({
      orgId: connection.orgId,
      connectionId: connection.id,
      source: "twenty",
      eventType: String(body.event ?? body.eventName ?? "unknown"),
      payload: body as Record<string, unknown>,
    }),
  );
  return NextResponse.json({ ok: true });
}
