import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import { mockFetch } from "../../../tests/helpers/fetch";
import { ConnectorExecutor } from "../connectors/executor";
import { createSlackConnection, saveGoogleConnection } from "../connectors/service";
import type { Db } from "../db/client";
import { actions, agentConfigs, agentEvents, agentRuns, identities, projects, prospects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { createBase, setAgentBase } from "../prospects/bases";
import { addProspectRow, saveProspects } from "../prospects/service";
import {
  addAgent,
  saveAgentAutomation,
  saveAgentInstructions,
  setAgentEnabled,
  type automationInput,
} from "../services/agents";
import { teamEmails } from "./automation";
import { processAgentEvents, recordAgentEvent, rowsAdded } from "./events";
import { runProspecting } from "./prospector";
import type { z } from "zod";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let ownerEmail: string;
let projectId: string;
let agentId: string;
let baseId: string;
let mailboxId: string;

const slack = mockFetch({ "POST https://hooks.slack.com/": () => "ok" });
const gateway = (): GatewayDeps => ({ db, executor: new ConnectorExecutor({ db, fetch: slack.fetch }) });
const agentActor = (): TenantContext => ({ ...tenant, actorType: "agent", actorId: "run" });
const automation = (raw: z.input<typeof automationInput>) =>
  saveAgentAutomation(db, tenant, projectId, "outbound", raw);
const config = async () =>
  (
    await withTenant(db, tenant, (tx) => tx.select().from(agentConfigs).where(eq(agentConfigs.id, agentId)))
  )[0];
/** A model turn that ends the run with a short summary. */
const done = { blocks: [{ type: "text" as const, text: "Hecho." }] };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Automatiza");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  ownerEmail = `${seeded.userId}@example.com`;
  const [p] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(projects)
      .values({ orgId: tenant.orgId, name: "Swipoo", timezone: "Europe/Madrid" })
      .returning(),
  );
  projectId = p.id;
  const agent = await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
  agentId = agent.id;
  const base = await createBase(db, tenant, projectId, {
    name: "Concesionarios",
    rowKind: "company",
    columns: [
      { name: "Ciudad", type: "text" },
      { name: "Email", type: "email" },
    ],
  });
  baseId = base.id;
  await setAgentBase(db, tenant, projectId, agentId, baseId);
  await saveAgentInstructions(db, tenant, projectId, "outbound", {
    instructions: "Concesionarios de Andalucía.",
    schedule: { kind: "daily", time: "08:00" },
    settings: { mode: "find", prospectsPerRun: 5 },
  });
  await setAgentEnabled(db, tenant, projectId, "outbound", true);
  await saveGoogleConnection({ db }, tenant, {
    email: "ventas@swipoo.com",
    name: "Ventas",
    ownerUserId: seeded.userId,
    credentials: { refreshToken: "r", scope: "https://www.googleapis.com/auth/gmail.compose" },
  });
  const ids = await withTenant(db, tenant, (tx) => tx.select().from(identities));
  mailboxId = ids.find((i) => i.kind === "email")!.id;
});
afterAll(async () => close());
beforeEach(async () => {
  // Every test starts from no automation.
  await automation({});
  await withTenant(db, tenant, (tx) =>
    tx.update(agentConfigs).set({ enabled: true }).where(eq(agentConfigs.id, agentId)),
  );
});

describe("caps, goal, sources and model", () => {
  it("stops a run at its spending cap, keeping what it saved", async () => {
    await automation({ budget: { maxCostPerRunUsd: 0.01 } });
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "save_prospects",
            input: { prospects: [{ companyName: "Autos Uno", website: "autosuno.es", fitScore: 80 }] },
          },
        ],
      },
      // About 0.008 $ a turn: the second one goes over the cap, and there's no third.
      {
        blocks: [
          { type: "tool_use", name: "check_prospects", input: { companies: [{ companyName: "Dos" }] } },
        ],
      },
      done,
    ]);
    const result = await runProspecting({ db, llm, gateway: gateway() }, tenant, {
      projectId,
      trigger: "manual",
    });
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({ status: "budget", added: 1 });
    expect(result.summary).toContain("límite de gasto");
    const [run] = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentRuns).where(eq(agentRuns.id, result.runId)),
    );
    expect(run.status).toBe("completed");
  });

  it("doesn't work once the month's cap is spent", async () => {
    await automation({ budget: { maxCostPerMonthUsd: 0.01 } });
    const result = await runProspecting({ db, llm: scriptedLlm([]).llm, gateway: gateway() }, tenant, {
      projectId,
      trigger: "schedule",
    });
    expect(result.status).toBe("skipped");
    expect(result.summary).toContain("este mes ya ha gastado");
  });

  it("stops looking for new rows when the goal is met, and pauses itself", async () => {
    await automation({ goal: { rows: 1, minFit: 70 } });
    const result = await runProspecting({ db, llm: scriptedLlm([]).llm, gateway: gateway() }, tenant, {
      projectId,
      trigger: "schedule",
    });
    expect(result.summary).toContain("Objetivo cumplido: 1 de 1 filas con encaje 70 o más");
    expect(await config()).toMatchObject({ enabled: false });
  });

  it("looks only where it may, with its own model, and asks for what's left of the goal", async () => {
    await automation({
      goal: { rows: 3 },
      sources: {
        allow: ["https://www.anfac.com/socios", "concesionarios.es"],
        block: ["linkedin.com"],
        prefer: "web",
      },
    });
    await saveAgentInstructions(db, tenant, projectId, "outbound", {
      instructions: "Concesionarios de Andalucía.",
      schedule: { kind: "daily", time: "08:00" },
      settings: { mode: "find", prospectsPerRun: 5, model: "claude-sonnet-5-5" },
    });
    await withTenant(db, tenant, (tx) =>
      tx
        .update(agentConfigs)
        .set({ tools: { web: true } })
        .where(eq(agentConfigs.id, agentId)),
    );
    // Saving the instructions keeps the automation settings.
    expect((await config()).settings.goal).toEqual({ rows: 3 });
    const { llm, requests } = scriptedLlm([done]);
    await runProspecting({ db, llm, gateway: gateway() }, tenant, { projectId, trigger: "manual" });
    expect(requests[0].model).toBe("claude-sonnet-5-5");
    const search = requests[0].tools?.find((t) => "name" in t && t.name === "web_search");
    expect(search).toMatchObject({ allowed_domains: ["anfac.com", "concesionarios.es"] });
    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toContain("No uses nunca como fuente: linkedin.com");
    // One row of three already there: two more.
    expect(system).toContain("Objetivo de esta ejecución: 2 prospectos nuevos");
    await saveAgentInstructions(db, tenant, projectId, "outbound", {
      instructions: "Concesionarios de Andalucía.",
      schedule: { kind: "daily", time: "08:00" },
      settings: { mode: "find", prospectsPerRun: 5 },
    });
  });

  it("refuses domains that aren't", async () => {
    await expect(automation({ sources: { allow: ["no es un dominio"] } })).rejects.toThrow(
      "No parecen dominios",
    );
  });
});

describe("event triggers", () => {
  it("completes rows a person adds, when it listens to new rows", async () => {
    const row = await addProspectRow(db, tenant, baseId, { companyName: "Motor Sur", fields: {} });
    expect(await rowsAdded(db, tenant, { baseId, rowIds: [row.id] })).toBeNull(); // not listening
    await automation({ triggers: { newRows: true } });
    expect(await rowsAdded(db, tenant, { baseId, rowIds: [row.id] })).toBe(agentId);

    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "update_prospects",
            input: { rows: [{ ref: "F1", fields: { ciudad: "Sevilla" }, notFound: ["email"] }] },
          },
        ],
      },
      (req) => {
        expect(lastToolResults(req)[0]).toMatchObject({ filled: 1 });
        return done;
      },
    ]);
    const outcome = await processAgentEvents({ db, llm, gateway: gateway() }, tenant, agentId);
    expect(outcome).toMatchObject({ status: "ran", events: 1, result: { completed: 1 } });
    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toMatch(/F1 · Motor Sur/);
    const events = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentEvents).where(eq(agentEvents.agentConfigId, agentId)),
    );
    expect(events.every((e) => e.processedAt && e.runId)).toBe(true);
    // Nothing pending: nothing to do.
    expect(
      await processAgentEvents({ db, llm: scriptedLlm([]).llm, gateway: gateway() }, tenant, agentId),
    ).toEqual({
      status: "idle",
    });
  });

  it("works with what a webhook posts, and gives the webhook a secret URL", async () => {
    await automation({ triggers: { webhook: true } });
    const token = (await config()).hookToken;
    expect(token).toMatch(/^[\w-]{30,}$/);
    await automation({ triggers: { webhook: true } });
    expect((await config()).hookToken).toBe(token); // kept
    expect(
      await recordAgentEvent(db, tenant, {
        agentConfigId: agentId,
        kind: "webhook",
        payload: { body: { evento: "nueva oportunidad", empresa: "Talleres Pérez" } },
      }),
    ).toBe(true);
    const { llm, requests } = scriptedLlm([done]);
    const outcome = await processAgentEvents({ db, llm, gateway: gateway() }, tenant, agentId);
    expect(outcome.status).toBe("ran");
    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toContain("## Avisos recibidos");
    expect(system).toContain("Talleres Pérez");
  });

  it("waits while the agent is paused", async () => {
    await automation({ triggers: { webhook: true } });
    await recordAgentEvent(db, tenant, {
      agentConfigId: agentId,
      kind: "webhook",
      payload: { body: "hola" },
    });
    await setAgentEnabled(db, tenant, projectId, "outbound", false);
    expect(
      await processAgentEvents({ db, llm: scriptedLlm([]).llm, gateway: gateway() }, tenant, agentId),
    ).toEqual({
      status: "paused",
    });
    await setAgentEnabled(db, tenant, projectId, "outbound", true);
    await processAgentEvents({ db, llm: scriptedLlm([done]).llm, gateway: gateway() }, tenant, agentId);
  });
});

describe("notices and the next step", () => {
  it("tells the team on Slack how the run went, through the gateway", async () => {
    const conn = await createSlackConnection({ db }, tenant, {
      label: "#ventas",
      webhookUrl: "https://hooks.slack.com/services/T000/B000/XXXXXXXX",
    });
    await expect(
      createSlackConnection({ db }, tenant, { label: "x", webhookUrl: "https://example.com/hook" }),
    ).rejects.toThrow("webhook de Slack");
    await automation({ notify: { slackConnectionId: conn.id, onProblem: true } });
    const before = slack.requests.length;
    // Nothing new found: a problem worth telling.
    await runProspecting({ db, llm: scriptedLlm([done]).llm, gateway: gateway() }, tenant, {
      projectId,
      trigger: "schedule",
    });
    expect(slack.requests.length).toBe(before + 1);
    expect((slack.requests.at(-1)!.body as { text: string }).text).toMatch(
      /⚠️ \*Agente outbound\* · Swipoo: No ha encontrado nada nuevo/,
    );
    const [notice] = await withTenant(db, tenant, (tx) =>
      tx.select().from(actions).where(eq(actions.type, "notify.slack")),
    );
    expect(notice.status).toBe("succeeded");
  });

  it("emails notices only to members of the organization", async () => {
    expect(await teamEmails(db, tenant.orgId, [ownerEmail.toUpperCase(), "cliente@fuera.es"])).toEqual([
      ownerEmail,
    ]);
    await expect(automation({ notify: { emails: [ownerEmail], onFinish: true } })).rejects.toThrow("buzón");
  });

  it("prepares a first email for rows that fit and leaves it for approval", async () => {
    await automation({ mailboxId, handoff: { enabled: true, minFit: 80, instructions: "Menciona la ITV." } });
    const { added } = await saveProspects(db, agentActor(), {
      baseId,
      items: [
        { companyName: "Autos Cádiz", fitScore: 92, fields: { email: "info@autoscadiz.es" } },
        { companyName: "Poco encaje", fitScore: 40, fields: { email: "info@poco.es" } },
        { companyName: "Sin email", fitScore: 95 },
      ],
    });
    const { llm, requests } = scriptedLlm([
      done,
      {
        blocks: [
          {
            type: "text",
            text: JSON.stringify({ subject: "Transferencias para Autos Cádiz", body: "Hola,\n…\nSwipoo" }),
          },
        ],
      },
    ]);
    const result = await runProspecting({ db, llm, gateway: gateway() }, tenant, {
      projectId,
      trigger: "manual",
    });
    expect(result.firstContacts).toMatchObject({ proposed: 1, blocked: [] });
    expect(result.summary).toContain("1 emails preparados");
    expect(JSON.stringify(requests[1].messages)).toContain("Menciona la ITV.");
    const [email] = await withTenant(db, tenant, (tx) =>
      tx.select().from(actions).where(eq(actions.type, "email.send")),
    );
    expect(email).toMatchObject({
      status: "pending_approval",
      payload: {
        identityId: mailboxId,
        to: ["info@autoscadiz.es"],
        subject: "Transferencias para Autos Cádiz",
      },
    });
    const contacted = await withTenant(db, tenant, (tx) =>
      tx
        .select({ id: prospects.id })
        .from(prospects)
        .where(and(eq(prospects.baseId, baseId), isNotNull(prospects.contactActionId))),
    );
    expect(contacted.map((r) => r.id)).toEqual([added.find((a) => a.companyName === "Autos Cádiz")!.id]);
    // Next run: that row already has its first email.
    const again = await runProspecting({ db, llm: scriptedLlm([done]).llm, gateway: gateway() }, tenant, {
      projectId,
      trigger: "manual",
    });
    expect(again.firstContacts).toMatchObject({ proposed: 0 });
  });
});
