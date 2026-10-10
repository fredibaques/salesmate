import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import {
  actions,
  agentRuns,
  connections,
  contacts,
  conversations,
  identities,
  inboundEvents,
  messages,
  projectIdentities,
  projects,
  prospectBases,
  prospects,
} from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { decideAction, type GatewayDeps } from "../gateway/gateway";
import type { LlmClient } from "../llm/client";
import { ingestTableFile } from "../knowledge/service";
import { personOfRow } from "../conversations/inbox";
import { setAgentBase } from "../prospects/bases";
import { addProspectRow } from "../prospects/service";
import {
  addAgent,
  getAgent,
  saveAgentChannels,
  saveAgentTriggers,
  setAgentEnabled,
} from "../services/agents";
import { queueWebhookLead, rowsAdded } from "./events";
import { runInboundSweep } from "./inbound-sweep";
import { recordActionInConversation } from "./conversations";
import { processInboundEvent, processPendingInbound } from "./inbound";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext & { actorType: "user"; actorId: string };
let projectId: string;
let mailboxId: string;
let inboundId: string;
let tableId: string;
let sourceId: string;

const executed: string[] = [];
const gateway = (): GatewayDeps => ({
  db,
  executor: {
    execute: async ({ action }) => {
      executed.push(action.type);
      return { messageId: `gmail-${executed.length}` };
    },
  },
  afterExecute: ({ orgId, action }) => recordActionInConversation(db, orgId, action),
  now: () => new Date("2026-10-07T09:00:00Z"),
});

async function formEvent(fields: Record<string, string>) {
  const [event] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(inboundEvents)
      .values({
        orgId: tenant.orgId,
        projectId,
        source: "form",
        eventType: "form.submitted",
        payload: { fields },
      })
      .returning(),
  );
  return event.id;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Inbound");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  ({ projectId, mailboxId } = await withTenant(db, tenant, async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        orgId: tenant.orgId,
        name: "Servicios B2B",
        description: "Gestión de trámites para empresas",
      })
      .returning();
    const [conn] = await tx
      .insert(connections)
      .values({ orgId: tenant.orgId, provider: "google", label: "Gmail", accountRef: "ventas@empresa.com" })
      .returning();
    const [mailbox] = await tx
      .insert(identities)
      .values({
        orgId: tenant.orgId,
        kind: "email",
        provider: "google",
        address: "ventas@empresa.com",
        connectionId: conn.id,
      })
      .returning();
    await tx
      .insert(projectIdentities)
      .values({ orgId: tenant.orgId, projectId: project.id, identityId: mailbox.id, isDefault: true });
    return { projectId: project.id, mailboxId: mailbox.id };
  }));
  inboundId = (await addAgent(db, tenant, projectId, "inbound", "b2b_consultative")).id;
  await saveAgentChannels(db, tenant, projectId, inboundId, { mailboxId });
  await setAgentEnabled(db, tenant, projectId, inboundId, true);
  const ingested = await ingestTableFile(db, tenant, {
    projectId,
    name: "Tarifas",
    filename: "tarifas.csv",
    data: Buffer.from("Servicio,Precio\nTrámite estándar,49\nTrámite urgente,89\n"),
  });
  tableId = ingested.tables[0].id;
  sourceId = ingested.source.id;
});

afterAll(async () => close());

describe("inbound agent", () => {
  it("turns a form submission into a contact, a conversation and a reply awaiting approval", async () => {
    const eventId = await formEvent({
      nombre: "Lucía Martín",
      email: "lucia@concesionario.com",
      empresa: "Motor Centro",
      mensaje: "Hola, ¿cuánto cuesta un trámite estándar? Hacemos unos 40 al mes.",
      acepto: "on",
    });

    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "query_table",
            input: { tableId, filters: [{ column: "servicio", op: "contains", value: "estándar" }] },
          },
        ],
      },
      (req) => {
        const [table] = lastToolResults(req) as { rows: { rowId: string; precio: number }[] }[];
        expect(table.rows[0].precio).toBe(49);
        return {
          blocks: [
            {
              type: "tool_use",
              name: "update_lead",
              input: {
                status: "qualified",
                fitScore: 80,
                classification: "pide presupuesto",
                customerType: "b2b",
              },
            },
            {
              type: "tool_use",
              name: "propose_action",
              input: {
                type: "email.send",
                reason: "Responder con el precio de la tarifa y proponer una llamada",
                payload: {
                  identityId: mailboxId,
                  to: ["lucia@concesionario.com"],
                  subject: "Precio del trámite estándar",
                  body: `Hola Lucía, el trámite estándar cuesta ${table.rows[0].precio} € por expediente. ¿Hablamos 15 minutos esta semana?`,
                },
                citations: [{ sourceId, ref: table.rows[0].rowId }],
              },
            },
          ],
        };
      },
      (req) => {
        const results = lastToolResults(req) as { outcome?: string }[];
        expect(results[1].outcome).toBe("pending_approval");
        return {
          blocks: [
            {
              type: "text",
              text: "Lucía (Motor Centro) pide precio para ~40 trámites/mes. Encaja. He propuesto responder con la tarifa estándar.",
            },
          ],
        };
      },
    ]);

    const outcome = await processInboundEvent(
      { db, llm, gateway: gateway(), now: () => new Date("2026-10-07T09:00:00Z") },
      tenant.orgId,
      eventId,
    );
    expect(outcome.status).toBe("processed");
    if (outcome.status !== "processed") return;

    // Prompt: playbook in the (cacheable) system prompt, time only in the user turn.
    expect(String(requests[0].system && JSON.stringify(requests[0].system))).toContain("B2B consultivo");
    expect(JSON.stringify(requests[0].system)).not.toContain("Ahora son las");
    expect(JSON.stringify(requests[0].messages[0].content)).toContain("Motor Centro");

    const state = await withTenant(db, tenant, async (tx) => ({
      contact: (await tx.select().from(contacts).where(eq(contacts.email, "lucia@concesionario.com")))[0],
      conversation: (
        await tx.select().from(conversations).where(eq(conversations.id, outcome.conversationId))
      )[0],
      run: (await tx.select().from(agentRuns).where(eq(agentRuns.id, outcome.runId)))[0],
      action: (await tx.select().from(actions).where(eq(actions.runId, outcome.runId)))[0],
      event: (await tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventId)))[0],
    }));
    expect(state.contact).toMatchObject({
      firstName: "Lucía",
      lastName: "Martín",
      companyName: "Motor Centro",
      status: "qualified",
      fitScore: 80,
      legalBasis: "consent",
    });
    expect(state.conversation).toMatchObject({ classification: "pide presupuesto", channel: "form" });
    expect(state.run).toMatchObject({ status: "completed", agentType: "inbound", inputTokens: 3000 });
    expect(state.run.summary).toContain("Motor Centro");
    expect(state.action).toMatchObject({
      type: "email.send",
      status: "pending_approval",
      agentType: "inbound",
    });
    expect(state.action.context).toEqual({
      customerType: "b2b",
      subjectRef: `conversation:${outcome.conversationId}`,
    });
    // Figures are backed by the cited table, so no extra warning for them.
    expect(state.action.policyResults.find((p) => p.policy === "backed_figures")?.outcome).toBe("allow");
    expect(state.event.status).toBe("processed");

    // Approving sends the email and records it in the conversation.
    await decideAction(gateway(), tenant, { actionId: state.action.id, decision: "approved" });
    const thread = await withTenant(db, tenant, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, outcome.conversationId)),
    );
    expect(thread.map((m) => m.direction).sort()).toEqual(["inbound", "outbound"]);
    expect(executed).toContain("email.send");
  });

  it("does not process the same event twice", async () => {
    const eventId = await formEvent({ email: "otro@cliente.com", mensaje: "Info" });
    const { llm } = scriptedLlm([{ blocks: [{ type: "text", text: "Resumen." }] }]);
    const deps = { db, llm, gateway: gateway() };
    expect((await processInboundEvent(deps, tenant.orgId, eventId)).status).toBe("processed");
    expect((await processInboundEvent(deps, tenant.orgId, eventId)).status).toBe("skipped");
  });

  it("ignores events without contact data, automated mail and our own mailboxes", async () => {
    const noData = await formEvent({ mensaje: "Hola" });
    const own = await formEvent({ email: "ventas@empresa.com", mensaje: "Prueba" });
    const [auto] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(inboundEvents)
        .values({
          orgId: tenant.orgId,
          projectId,
          source: "gmail",
          eventType: "email.received",
          externalId: "m-auto",
          payload: {
            messageId: "m-auto",
            threadId: "t-auto",
            rfcMessageId: null,
            from: { email: "ana@cliente.com", name: "Ana" },
            to: ["ventas@empresa.com"],
            subject: "Respuesta automática: fuera de la oficina",
            text: "Estoy de vacaciones",
            date: null,
            autoSubmitted: false,
          },
        })
        .returning(),
    );
    const { llm } = scriptedLlm([]);
    const outcomes = await processPendingInbound({ db, llm, gateway: gateway() }, tenant.orgId);
    const reasons = outcomes.map((o) => (o.status === "ignored" ? o.reason : o.status));
    expect(reasons.sort()).toEqual(["automated", "no_contact_data", "own_message"]);
    expect([noData, own, auto.id]).toHaveLength(3);
  });

  it("records failures and lets the event be retried", async () => {
    const eventId = await formEvent({ email: "fallo@cliente.com", mensaje: "Hola" });
    const failing: LlmClient = {
      provider: "anthropic",
      model: "claude-opus-5-5",
      create: async () => {
        throw new Error("API caída");
      },
    };
    const outcome = await processInboundEvent(
      { db, llm: failing, gateway: gateway() },
      tenant.orgId,
      eventId,
    );
    expect(outcome).toEqual({ status: "error", error: "API caída" });
    const { llm } = scriptedLlm([{ blocks: [{ type: "text", text: "Ok." }] }]);
    expect((await processInboundEvent({ db, llm, gateway: gateway() }, tenant.orgId, eventId)).status).toBe(
      "processed",
    );
  });

  it("keeps the message but doesn't answer once a person has taken the conversation over", async () => {
    const first = await formEvent({ email: "tomada@cliente.com", mensaje: "Hola" });
    const { llm } = scriptedLlm([{ blocks: [{ type: "text", text: "Resumen." }] }]);
    const done = await processInboundEvent({ db, llm, gateway: gateway() }, tenant.orgId, first);
    if (done.status !== "processed") throw new Error(done.status);
    await withTenant(db, tenant, (tx) =>
      tx.update(conversations).set({ status: "handed_off" }).where(eq(conversations.id, done.conversationId)),
    );

    const again = await formEvent({ email: "tomada@cliente.com", mensaje: "¿Me llamáis?" });
    // No scripted answers: the agent must not run.
    const quiet = scriptedLlm([]);
    const outcome = await processInboundEvent(
      { db, llm: quiet.llm, gateway: gateway() },
      tenant.orgId,
      again,
    );
    expect(outcome).toEqual({ status: "handed_off", conversationId: done.conversationId });
    expect(quiet.requests).toHaveLength(0);
    const thread = await withTenant(db, tenant, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, done.conversationId)),
    );
    expect(thread.map((m) => m.body)).toContain("¿Me llamáis?");
    const [conv] = await withTenant(db, tenant, (tx) =>
      tx.select().from(conversations).where(eq(conversations.id, done.conversationId)),
    );
    expect(conv.status).toBe("handed_off");
  });

  it("writes each person into the table it works on, once, linked to their conversation", async () => {
    const [base] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(prospectBases)
        .values({
          orgId: tenant.orgId,
          projectId,
          name: "Leads",
          rowKind: "person",
          columns: [
            { id: "email", name: "Email", type: "email", filledBy: "agent" },
            { id: "tel", name: "Teléfono", type: "phone", filledBy: "agent" },
          ],
        })
        .returning(),
    );
    const agent = await getAgent(db, tenant, projectId, inboundId);
    await setAgentBase(db, tenant, projectId, agent!.config.id, base.id);

    for (const mensaje of ["Quiero información", "¿Seguís ahí?"]) {
      const eventId = await formEvent({
        nombre: "Ana Ruiz",
        email: "Ana@Taller.es",
        empresa: "Taller Ruiz",
        telefono: "600 111 222",
        mensaje,
      });
      const { llm } = scriptedLlm([{ blocks: [{ type: "text", text: "Hecho." }] }]);
      await processInboundEvent({ db, llm, gateway: gateway() }, tenant.orgId, eventId);
    }

    const rows = await withTenant(db, tenant, (tx) =>
      tx.select().from(prospects).where(eq(prospects.baseId, base.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      personName: "Ana Ruiz",
      companyName: "Taller Ruiz",
      data: { email: "ana@taller.es" },
    });
    // The row opens the person's conversation.
    expect(await personOfRow(db, tenant, rows[0].id)).toBe("e:ana@taller.es");

    // Without a table it writes nowhere.
    await setAgentBase(db, tenant, projectId, agent!.config.id, null);
    expect((await getAgent(db, tenant, projectId, inboundId))?.config.prospectBaseId).toBeNull();
  });

  it("listens to what its triggers say: the web form, new rows of its table and notices from other tools", async () => {
    const reply = () =>
      scriptedLlm(Array.from({ length: 4 }, () => ({ blocks: [{ type: "text" as const, text: "Hecho." }] })));
    const agent = (await getAgent(db, tenant, projectId, inboundId))!;
    const [base] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(prospectBases)
        .values({
          orgId: tenant.orgId,
          projectId,
          name: "Solicitudes",
          rowKind: "person",
          columns: [{ id: "correo", name: "Correo", type: "email", filledBy: "person" }],
        })
        .returning(),
    );
    await setAgentBase(db, tenant, projectId, agent.config.id, base.id);

    // The web form can be turned off.
    await saveAgentTriggers(db, tenant, projectId, inboundId, {
      form: false,
      newRows: false,
      webhook: false,
    });
    const off = await formEvent({ email: "callado@cliente.com", mensaje: "Hola" });
    expect(
      await processInboundEvent({ db, llm: reply().llm, gateway: gateway() }, tenant.orgId, off),
    ).toEqual({
      status: "ignored",
      reason: "trigger_off",
    });

    // A row someone adds to its table is a lead, only while it listens to new rows.
    const row = await addProspectRow(db, tenant, base.id, {
      personName: "Rosa Díaz",
      companyName: "Talleres Díaz",
      fields: { correo: "rosa@talleres.es" },
    });
    expect(await rowsAdded(db, tenant, { baseId: base.id, rowIds: [row.id] })).toEqual({
      prospecting: [],
      inbound: [],
    });
    await saveAgentTriggers(db, tenant, projectId, inboundId, { form: true, newRows: true, webhook: true });
    expect((await rowsAdded(db, tenant, { baseId: base.id, rowIds: [row.id] })).inbound).toEqual([inboundId]);
    // The same row is queued once.
    await rowsAdded(db, tenant, { baseId: base.id, rowIds: [row.id] });

    // A notice from another tool needs someone to attend.
    expect(await queueWebhookLead(db, tenant, agent.config, { evento: "nuevo" })).toBe(false);
    expect(
      await queueWebhookLead(db, tenant, agent.config, {
        name: "Iván",
        email: "ivan@flota.es",
        message: "Precio?",
      }),
    ).toBe(true);
    const hooked = (await getAgent(db, tenant, projectId, inboundId))!;
    expect(hooked.config.hookToken).toBeTruthy();

    // One run of the agent attends what is waiting in its project.
    const { outcomes } = await runInboundSweep(
      { db, llm: reply().llm, gateway: gateway() },
      tenant,
      inboundId,
    );
    expect(outcomes.filter((o) => o.status === "processed")).toHaveLength(2);
    const people = await withTenant(db, tenant, (tx) =>
      tx.select({ email: contacts.email }).from(contacts).where(eq(contacts.projectId, projectId)),
    );
    expect(people.map((p) => p.email)).toEqual(expect.arrayContaining(["rosa@talleres.es", "ivan@flota.es"]));
    const sources = await withTenant(db, tenant, (tx) =>
      tx.select({ source: inboundEvents.source, status: inboundEvents.status }).from(inboundEvents),
    );
    expect(sources.filter((e) => e.source === "table")).toEqual([{ source: "table", status: "processed" }]);
    expect(sources.filter((e) => e.source === "webhook")).toEqual([
      { source: "webhook", status: "processed" },
    ]);
  });

  it("sends each lead to its own agent when the project has several inbound agents", async () => {
    const reply = () =>
      scriptedLlm(Array.from({ length: 3 }, () => ({ blocks: [{ type: "text" as const, text: "Hecho." }] })));
    const second = await addAgent(db, tenant, projectId, "inbound");
    expect(second.name).toBe("Agente inbound 2");
    await setAgentEnabled(db, tenant, projectId, second.id, true);
    await saveAgentTriggers(db, tenant, projectId, second.id, { form: false, newRows: false, webhook: true });
    await saveAgentTriggers(db, tenant, projectId, inboundId, { form: true, newRows: false, webhook: false });

    // A notice to the second agent's webhook is for it: the first one's run leaves it waiting.
    expect(await queueWebhookLead(db, tenant, second, { email: "eva@flota.es", mensaje: "Hola" })).toBe(true);
    const pending = () =>
      withTenant(db, tenant, (tx) =>
        tx.select().from(inboundEvents).where(eq(inboundEvents.agentConfigId, second.id)),
      );
    await runInboundSweep({ db, llm: reply().llm, gateway: gateway() }, tenant, inboundId);
    expect((await pending())[0].status).toBe("pending");
    const own = await runInboundSweep({ db, llm: reply().llm, gateway: gateway() }, tenant, second.id);
    expect(own.outcomes.map((o) => o.status)).toEqual(["processed"]);
    const runOf = async (outcome: unknown) => {
      const runId = (outcome as { runId: string }).runId;
      const [run] = await withTenant(db, tenant, (tx) =>
        tx.select().from(agentRuns).where(eq(agentRuns.id, runId)),
      );
      return run.agentConfigId;
    };
    expect(await runOf(own.outcomes[0])).toBe(second.id);

    // The web form goes to the agent that attends it, even from the other one's run.
    const form = await formEvent({ email: "luis@cliente.com", mensaje: "Información" });
    const outcome = await processInboundEvent(
      { db, llm: reply().llm, gateway: gateway() },
      tenant.orgId,
      form,
      second.id,
    );
    expect(await runOf(outcome)).toBe(inboundId);
  });
});
