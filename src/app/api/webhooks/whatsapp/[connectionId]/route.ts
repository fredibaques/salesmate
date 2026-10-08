import { after, NextResponse } from "next/server";
import { processInboundEvent } from "@/server/agents/inbound";
import { inboundDeps } from "@/server/agents/runtime";
import { queueWhatsappMessages, whatsappConnection } from "@/server/agents/whatsapp-inbound";
import { parseWhatsappWebhook, verifyWhatsappSignature } from "@/server/connectors/whatsapp";
import { getDb } from "@/server/db/client";
import { orgLlm } from "@/server/llm/org-ai";

export const maxDuration = 300;

/**
 * Meta checks the webhook once when it is set up: it sends our verify token
 * and expects its challenge back.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/webhooks/whatsapp/[connectionId]">) {
  const { connectionId } = await ctx.params;
  const connection = await whatsappConnection(getDb(), connectionId);
  const url = new URL(request.url);
  if (
    connection &&
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === connection.creds.verifyToken
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/**
 * Messages to the connected number. The signature (app secret) proves they
 * come from Meta. They are queued for the inbound agent and handled after
 * answering, so Meta doesn't retry.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/webhooks/whatsapp/[connectionId]">) {
  const { connectionId } = await ctx.params;
  const db = getDb();
  const connection = await whatsappConnection(db, connectionId);
  if (!connection) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const rawBody = await request.text();
  if (
    !verifyWhatsappSignature(connection.creds.appSecret, rawBody, request.headers.get("x-hub-signature-256"))
  ) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { eventIds } = await queueWhatsappMessages(db, connection, parseWhatsappWebhook(body));
  if (eventIds.length) {
    // Without the organization's AI the messages wait in the queue.
    const llm = await orgLlm(db, { orgId: connection.orgId });
    if (llm) {
      after(async () => {
        for (const id of eventIds) await processInboundEvent(inboundDeps(llm), connection.orgId, id);
      });
    }
  }
  return NextResponse.json({ ok: true });
}
