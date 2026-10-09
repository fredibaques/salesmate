import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { scriptedLlm } from "../../../tests/helpers/fake-llm";
import { mockFetch } from "../../../tests/helpers/fetch";
import { processInboundEvent } from "../agents/inbound";
import { queueWhatsappMessages, whatsappConnection } from "../agents/whatsapp-inbound";
import type { Db } from "../db/client";
import { actions, identities, inboundEvents, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { decideAction, type GatewayDeps } from "../gateway/gateway";
import { addAgent, saveAgentChannels, setAgentEnabled } from "../services/agents";
import { ConnectorExecutor } from "./executor";
import { createWhatsappConnection, whatsappVerifyToken } from "./service";
import { parseWhatsappWebhook, renderTemplate, verifyWhatsappSignature, whatsappProvider } from "./whatsapp";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext & { actorType: "user"; actorId: string };
let projectId: string;

const graph = mockFetch({
  "GET https://graph.facebook.com/v21.0/1234567890": () => ({
    display_phone_number: "+34 600 111 222",
    verified_name: "Swipoo",
  }),
  "POST https://graph.facebook.com/v21.0/1234567890/messages": () => ({ messages: [{ id: "wamid.OUT1" }] }),
});
const gateway = (): GatewayDeps => ({
  db,
  executor: new ConnectorExecutor({ db, fetch: graph.fetch }),
  // Inside the project's send window.
  now: () => new Date("2026-10-07T09:00:00Z"),
});

const delivery = (id: string, text: string) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "1234567890" },
            contacts: [{ wa_id: "34611222333", profile: { name: "Ana Ruiz" } }],
            messages: [
              { id, from: "34611222333", timestamp: "1791370000", type: "text", text: { body: text } },
            ],
          },
        },
      ],
    },
  ],
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "WA");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx.insert(projects).values({ orgId: tenant.orgId, name: "Swipoo" }).returning(),
  );
  projectId = p.id;
});
afterAll(async () => close());

describe("WhatsApp Business", () => {
  it("checks the number and adds it as an identity", async () => {
    const conn = await createWhatsappConnection({ db, fetch: graph.fetch }, tenant, {
      label: "WhatsApp ventas",
      accessToken: "EAAG-token-de-prueba-123456",
      phoneNumberId: "1234567890",
      appSecret: "secreto-de-la-app-123",
    });
    expect(conn).toMatchObject({
      provider: "whatsapp",
      accountRef: "+34 600 111 222",
      writeScopes: ["whatsapp"],
    });
    expect(graph.requests[0].headers.authorization).toBe("Bearer EAAG-token-de-prueba-123456");
    const [identity] = await withTenant(db, tenant, (tx) =>
      tx.select().from(identities).where(eq(identities.kind, "whatsapp")),
    );
    expect(identity).toMatchObject({
      address: "+34 600 111 222",
      displayName: "Swipoo",
      connectionId: conn.id,
    });
    // Reconnecting keeps the verify token Meta already has.
    const token = await whatsappVerifyToken({ db }, tenant, conn.id);
    await createWhatsappConnection({ db, fetch: graph.fetch }, tenant, {
      label: "WhatsApp ventas",
      accessToken: "EAAG-token-de-prueba-654321",
      phoneNumberId: "1234567890",
      appSecret: "secreto-de-la-app-123",
    });
    expect(await whatsappVerifyToken({ db }, tenant, conn.id)).toBe(token);
  });

  it("only trusts deliveries signed with the app secret", () => {
    const raw = JSON.stringify(delivery("wamid.1", "Hola"));
    const sig = `sha256=${createHmac("sha256", "secreto-de-la-app-123").update(raw).digest("hex")}`;
    expect(verifyWhatsappSignature("secreto-de-la-app-123", raw, sig)).toBe(true);
    expect(verifyWhatsappSignature("otro-secreto-cualquiera", raw, sig)).toBe(false);
    expect(verifyWhatsappSignature("secreto-de-la-app-123", raw, null)).toBe(false);
    expect(parseWhatsappWebhook(JSON.parse(raw))).toEqual([
      expect.objectContaining({ id: "wamid.1", from: "34611222333", name: "Ana Ruiz", text: "Hola" }),
    ]);
  });

  it("hands messages to the inbound agent that answers from that number, which replies by WhatsApp", async () => {
    const [identity] = await withTenant(db, tenant, (tx) =>
      tx.select().from(identities).where(eq(identities.kind, "whatsapp")),
    );
    const conn = (await whatsappConnection(db, identity.connectionId!))!;
    const messages = parseWhatsappWebhook(delivery("wamid.2", "¿Cuánto cuesta una transferencia?"));
    expect(await queueWhatsappMessages(db, conn, messages)).toEqual({ eventIds: [], reason: "no_project" });

    await addAgent(db, tenant, projectId, "inbound", "b2b_transactional");
    await saveAgentChannels(db, tenant, projectId, "inbound", { whatsappId: identity.id });
    await setAgentEnabled(db, tenant, projectId, "inbound", true);
    const { eventIds } = await queueWhatsappMessages(db, conn, messages);
    expect(eventIds).toHaveLength(1);
    // Meta retries: the same message isn't queued twice.
    expect((await queueWhatsappMessages(db, conn, messages)).eventIds).toEqual([]);

    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "propose_action",
            input: {
              type: "whatsapp.send",
              payload: {
                identityId: identity.id,
                to: "+34611222333",
                body: "¡Hola Ana! Te cuento los precios.",
              },
              reason: "Responder a la consulta",
            },
          },
        ],
      },
      { blocks: [{ type: "text", text: "Ana pregunta precios; propuesta respuesta por WhatsApp." }] },
    ]);
    const outcome = await processInboundEvent({ db, llm, gateway: gateway() }, tenant.orgId, eventIds[0]);
    expect(outcome.status).toBe("processed");
    const ask = JSON.stringify(requests[0].messages);
    expect(ask).toContain("Nuevo mensaje por WhatsApp de Ana Ruiz");
    expect(ask).toContain("Responde por WhatsApp");

    const [proposal] = await withTenant(db, tenant, (tx) =>
      tx.select().from(actions).where(eq(actions.type, "whatsapp.send")),
    );
    expect(proposal).toMatchObject({ status: "pending_approval", targetKeys: ["phone:+34611222333"] });

    // Approved by a person: it goes out through the Cloud API.
    const sent = await decideAction(gateway(), tenant, { actionId: proposal.id, decision: "approved" });
    expect(sent.outcome).toBe("executed");
    expect(graph.requests.at(-1)).toMatchObject({
      method: "POST",
      body: { messaging_product: "whatsapp", to: "34611222333", type: "text" },
    });
    const [event] = await withTenant(db, tenant, (tx) =>
      tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventIds[0])),
    );
    expect(event.status).toBe("processed");
  });

  it("lists the account's approved templates and sends one with its gaps filled", async () => {
    const meta = mockFetch({
      "GET https://graph.facebook.com/v21.0/555666777/message_templates": () => ({
        data: [
          {
            name: "seguimiento",
            language: "es",
            status: "APPROVED",
            category: "UTILITY",
            components: [{ type: "BODY", text: "Hola {{1}}, ¿pudiste ver lo de {{2}}?" }],
          },
          { name: "borrador", language: "es", status: "PENDING", components: [] },
        ],
      }),
      "POST https://graph.facebook.com/v21.0/1234567890/messages": () => ({ messages: [{ id: "wamid.t1" }] }),
    });
    const creds = {
      accessToken: "EAAG-token-de-prueba-123456",
      phoneNumberId: "1234567890",
      appSecret: "secreto-de-la-app-123",
      verifyToken: "x".repeat(20),
      businessAccountId: "555666777",
    };
    const client = whatsappProvider.create(creds, { fetch: meta.fetch } as never);
    const templates = await client["whatsapp.list_templates"]!();
    expect(templates).toEqual([
      {
        name: "seguimiento",
        language: "es",
        category: "UTILITY",
        body: "Hola {{1}}, ¿pudiste ver lo de {{2}}?",
        params: 2,
      },
    ]);
    expect(renderTemplate(templates[0].body, ["Ana", "la transferencia"])).toBe(
      "Hola Ana, ¿pudiste ver lo de la transferencia?",
    );
    await client["whatsapp.send"]!({
      to: "+34 611 222 333",
      body: "Hola Ana, ¿pudiste ver lo de la transferencia?",
      template: { name: "seguimiento", language: "es", params: ["Ana", "la transferencia"] },
    });
    expect(meta.requests.at(-1)!.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "34611222333",
      type: "template",
      template: {
        name: "seguimiento",
        language: { code: "es" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Ana" },
              { type: "text", text: "la transferencia" },
            ],
          },
        ],
      },
    });
    // Without the account's id there is nothing to list.
    const noAccount = whatsappProvider.create({ ...creds, businessAccountId: undefined }, {
      fetch: meta.fetch,
    } as never);
    await expect(noAccount["whatsapp.list_templates"]!()).rejects.toThrow(/identificador de la cuenta/);
  });
});
