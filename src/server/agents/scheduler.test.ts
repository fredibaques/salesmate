import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, inboundEvents, projects } from "../db/schema";
import { withSystem, withTenant, type TenantContext } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { listBases } from "../prospects/bases";
import { listProspects } from "../prospects/service";
import { addAgent, saveAgentInstructions, setAgentEnabled } from "../services/agents";
import { prospectingSteer, runProspecting } from "./prospector";
import { closeStaleRuns, describeNextRun, isDue, localClock, runDueAgents } from "./scheduler";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;
let agentId: string;

const config = async () =>
  (
    await withTenant(db, tenant, (tx) =>
      tx.select().from(agentConfigs).where(eq(agentConfigs.projectId, projectId)),
    )
  )[0];

const gateway = (): GatewayDeps => ({ db, executor: { execute: async () => ({}) } });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Sched");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  projectId = await withTenant(db, tenant, async (tx) => {
    const [p] = await tx
      .insert(projects)
      .values({
        orgId: tenant.orgId,
        name: "Gestoría",
        timezone: "Europe/Madrid",
        salesProfile: { offer: "Transferencias de vehículos", segment: { include: ["Concesionarios"] } },
      })
      .returning();
    return p.id;
  });
});
afterAll(async () => close());

describe("schedule", () => {
  const schedule = { time: "08:00", days: [1, 2, 3, 4, 5] };
  // Wednesday 7 October 2026, 08:30 in Madrid (06:30 UTC).
  const wednesday = new Date("2026-10-07T06:30:00Z");

  it("reads the clock in the project's time zone", () => {
    expect(localClock(wednesday, "Europe/Madrid")).toEqual({ date: "2026-10-07", weekday: 3, time: "08:30" });
  });

  it("is due once per day, after its time, on its days", () => {
    expect(isDue(schedule, null, wednesday, "Europe/Madrid")).toBe(true);
    expect(isDue(schedule, null, new Date("2026-10-07T05:30:00Z"), "Europe/Madrid")).toBe(false);
    expect(isDue(schedule, new Date("2026-10-07T06:00:00Z"), wednesday, "Europe/Madrid")).toBe(false);
    expect(isDue(schedule, new Date("2026-10-06T06:00:00Z"), wednesday, "Europe/Madrid")).toBe(true);
    expect(isDue(schedule, null, new Date("2026-10-10T08:00:00Z"), "Europe/Madrid")).toBe(false); // Saturday
  });

  it("works every day, on a day of the month, or once", () => {
    const tz = "Europe/Madrid";
    const daily = { kind: "daily" as const, time: "08:00" };
    expect(isDue(daily, null, new Date("2026-10-10T08:00:00Z"), tz)).toBe(true); // Saturday too
    const monthly = { kind: "monthly" as const, time: "08:00", day: 7 };
    expect(isDue(monthly, null, wednesday, tz)).toBe(true);
    expect(isDue(monthly, null, new Date("2026-10-08T06:30:00Z"), tz)).toBe(false);
    // Day 31 in a 30-day month: its last day.
    const endOfMonth = { kind: "monthly" as const, time: "08:00", day: 31 };
    expect(isDue(endOfMonth, null, new Date("2026-11-30T08:00:00Z"), tz)).toBe(true);
    expect(isDue(endOfMonth, null, new Date("2026-11-29T08:00:00Z"), tz)).toBe(false);
    const once = { kind: "once" as const, at: "2026-10-07T08:15" };
    expect(isDue(once, null, new Date("2026-10-07T06:00:00Z"), tz)).toBe(false); // 08:00, before
    expect(isDue(once, null, wednesday, tz)).toBe(true);
    expect(isDue(once, new Date("2026-10-07T06:20:00Z"), new Date("2026-10-09T06:00:00Z"), tz)).toBe(false);
    // Moved to a later moment: works again then.
    expect(
      isDue(
        { kind: "once", at: "2026-10-09T08:00" },
        new Date("2026-10-07T06:20:00Z"),
        new Date("2026-10-09T06:00:00Z"),
        tz,
      ),
    ).toBe(true);
  });
});

describe("runDueAgents", () => {
  it("runs the prospecting agent when its time comes, and only once", async () => {
    agentId = (await addAgent(db, tenant, projectId, "outbound", "b2b_consultative")).id;
    await saveAgentInstructions(db, tenant, projectId, agentId, {
      instructions: "Concesionarios de Andalucía.",
      schedule: { time: "08:00", days: [1, 2, 3, 4, 5] },
      settings: { prospectsPerRun: 2 },
    });
    const now = () => new Date("2026-10-07T06:30:00Z");

    // Not enabled yet: nothing runs.
    expect(
      await runDueAgents({ db, llmFor: async () => scriptedLlm([]).llm, gateway: gateway(), now }),
    ).toEqual({ runs: [], skipped: [], checked: 0 });
    await setAgentEnabled(db, tenant, projectId, agentId, true);

    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "check_prospects",
            input: { companies: [{ companyName: "Autos García", website: "autosgarcia.es" }] },
          },
        ],
      },
      (req) => {
        expect(lastToolResults(req)[0]).toEqual({ alreadyKnown: [] });
        return {
          blocks: [
            {
              type: "tool_use",
              name: "save_prospects",
              input: {
                prospects: [
                  {
                    companyName: "Autos García",
                    website: "https://autosgarcia.es",
                    city: "Málaga",
                    // The only criterion (segment «Concesionarios»), checked: the score is computed.
                    fit: { c1: "yes" },
                    fitReason: "Concesionario multimarca con volumen de transferencias",
                    sources: ["https://autosgarcia.es"],
                  },
                ],
              },
            },
          ],
        };
      },
      { blocks: [{ type: "text", text: "He guardado 1 concesionario de Málaga." }] },
    ]);
    // An organization without AI connected is skipped, keeps its slot and is told why.
    expect(await runDueAgents({ db, llmFor: async () => null, gateway: gateway(), now })).toEqual({
      runs: [],
      skipped: [{ projectId, reason: "no_ai" }],
      checked: 1,
    });
    expect((await config()).scheduleNote).toContain("IA");
    const report = await runDueAgents({ db, llmFor: async () => llm, gateway: gateway(), now });
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0].result).toMatchObject({ status: "completed", added: 1 });
    expect(await config()).toMatchObject({ scheduleNote: null, scheduleCheckedAt: now() });

    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toContain("Concesionarios de Andalucía.");
    expect(system).toContain("Qué vendemos: Transferencias de vehículos");
    expect(requests[0].tools?.map((t) => ("name" in t ? t.name : t.type))).toEqual(
      expect.arrayContaining(["save_prospects", "check_prospects", "web_search", "web_fetch"]),
    );

    const [base] = await listBases(db, tenant, projectId);
    const { rows } = await listProspects(db, tenant, base.id);
    expect(rows.map((r) => [r.companyName, r.fitScore])).toEqual([["Autos García", 100]]);
    const runs = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentRuns).where(eq(agentRuns.projectId, projectId)),
    );
    expect(runs.map((r) => [r.agentType, r.trigger, r.status])).toEqual([
      ["outbound", "schedule", "completed"],
    ]);

    // Same day again: already ran.
    expect(
      (await runDueAgents({ db, llmFor: async () => scriptedLlm([]).llm, gateway: gateway(), now })).runs,
    ).toEqual([]);
    expect((await config()).lastScheduledRunAt).toEqual(now());
  });

  it("claims a slot whose last run was stored with microseconds", async () => {
    // Postgres keeps microseconds; a millisecond comparison used to never match,
    // so the agent was skipped silently every day after.
    await withSystem(db, (tx) =>
      tx.execute(
        sql`update agent_configs set last_scheduled_run_at = '2026-10-05 16:18:13.443697+00' where project_id = ${projectId}`,
      ),
    );
    const now = () => new Date("2026-10-08T06:30:00Z");
    const { llm } = scriptedLlm([{ blocks: [{ type: "text", text: "Hoy no he encontrado nada nuevo." }] }]);
    const report = await runDueAgents({ db, llmFor: async () => llm, gateway: gateway(), now });
    expect(report.runs).toHaveLength(1);
    expect((await config()).lastScheduledRunAt).toEqual(now());
  });
});

describe("describeNextRun", () => {
  const schedule = { time: "08:00", days: [1, 2, 3, 4, 5] };
  const tz = "Europe/Madrid";
  // 2026-10-07 is a Wednesday; 05:00Z is 07:00 in Madrid.
  it("says when the agent works next, in words", () => {
    expect(describeNextRun(schedule, null, new Date("2026-10-07T05:00:00Z"), tz)).toBe("hoy a las 08:00");
    expect(describeNextRun(schedule, null, new Date("2026-10-07T07:00:00Z"), tz)).toContain("ahora");
    const ranToday = new Date("2026-10-07T06:05:00Z");
    expect(describeNextRun(schedule, ranToday, new Date("2026-10-07T09:00:00Z"), tz)).toBe(
      "mañana a las 08:00",
    );
    // Friday after its run: Monday.
    expect(
      describeNextRun(schedule, new Date("2026-10-09T06:05:00Z"), new Date("2026-10-09T09:00:00Z"), tz),
    ).toBe("el lunes a las 08:00");
  });

  it("names the date when it's further than a week, and stops after a single run", () => {
    const now = new Date("2026-10-07T09:00:00Z");
    expect(describeNextRun({ kind: "monthly", time: "08:00", day: 1 }, null, now, tz)).toBe(
      "el 1 de noviembre a las 08:00",
    );
    expect(describeNextRun({ kind: "daily", time: "08:00" }, now, now, tz)).toBe("mañana a las 08:00");
    const once = { kind: "once" as const, at: "2026-10-20T10:30" };
    expect(describeNextRun(once, null, now, tz)).toBe("el 20 de octubre a las 10:30");
    expect(
      describeNextRun(once, new Date("2026-10-20T08:31:00Z"), new Date("2026-10-21T09:00:00Z"), tz),
    ).toBeNull();
  });
});

describe("time limits", () => {
  it("ends a run that runs out of time as completed, keeping what it saved", async () => {
    const { llm } = scriptedLlm([
      {
        blocks: [
          {
            type: "tool_use",
            name: "save_prospects",
            input: { prospects: [{ companyName: "Motos Levante", website: "motoslevante.es" }] },
          },
        ],
      },
    ]);
    const result = await runProspecting({ db, llm, gateway: gateway(), timeBudgetMs: 0 }, tenant, {
      agentId,
      trigger: "manual",
    });
    expect(result).toMatchObject({ status: "deadline", added: 1 });
    const [run] = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentRuns).where(eq(agentRuns.id, result.runId)),
    );
    expect(run.status).toBe("completed");
    expect(run.summary).toContain("Se acabó el tiempo");
  });

  it("asks the agent to save what it found before searching more, and to wrap up at the end", async () => {
    const search = (q: string) => ({
      type: "server_tool_use" as const,
      name: "web_search",
      input: { query: q },
    });
    const read = (url: string) => ({ type: "server_tool_use" as const, name: "web_fetch", input: { url } });
    const lastNote = (req: { messages: { content: unknown }[] }) => {
      const content = req.messages.at(-1)?.content;
      const text = Array.isArray(content) ? content.find((b) => b.type === "text") : undefined;
      return text ? (text as { text: string }).text : null;
    };
    const { llm, requests } = scriptedLlm([
      {
        blocks: [
          ...["a", "b", "c", "d"].map((q) => search(`talleres ${q}`)),
          ...["1", "2", "3", "4", "5"].map((n) => read(`https://taller${n}.es`)),
          {
            type: "tool_use",
            name: "check_prospects",
            input: { companies: [{ companyName: "Taller Uno" }] },
          },
        ],
      },
      (req) => {
        expect(lastNote(req)).toContain("9 búsquedas y lecturas sin guardar");
        return {
          blocks: [
            {
              type: "tool_use",
              name: "save_prospects",
              input: { prospects: [{ companyName: "Taller Uno", website: "taller1.es" }] },
            },
          ],
        };
      },
      (req) => {
        // Saved: no note until the next streak.
        expect(lastNote(req)).toBeNull();
        return { blocks: [{ type: "text", text: "He guardado 1 taller." }] };
      },
    ]);
    const result = await runProspecting({ db, llm, gateway: gateway() }, tenant, {
      agentId,
      trigger: "manual",
    });
    expect(result).toMatchObject({ status: "completed", added: 1 });
    // Few searches per request, so each turn hands control back soon.
    const web = requests[0].tools?.find((t) => "name" in t && t.name === "web_search");
    expect(web).toMatchObject({ max_uses: 5 });
  });

  it("tells the agent to stop searching and save when time is nearly up, once", () => {
    let clock = 0;
    const steer = prospectingSteer({ deadline: 170_000, now: () => clock });
    clock = 100_000;
    expect(steer({ steps: [] })).toBeNull();
    clock = 130_000;
    expect(steer({ steps: [] })).toContain("No busques más");
    clock = 150_000;
    expect(steer({ steps: [] })).toBeNull();
  });

  it("closes runs the platform cut off", async () => {
    const [stuck] = await withTenant(db, tenant, (tx) =>
      tx
        .insert(agentRuns)
        .values({
          orgId: tenant.orgId,
          projectId,
          agentType: "outbound",
          trigger: "manual",
          model: "claude-opus-5-5",
          startedAt: new Date("2026-10-07T06:00:00Z"),
        })
        .returning(),
    );
    expect(await closeStaleRuns(db, new Date("2026-10-07T06:05:00Z"))).toBe(0);
    expect(await closeStaleRuns(db, new Date("2026-10-07T06:20:00Z"))).toBe(1);
    const [run] = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentRuns).where(eq(agentRuns.id, stuck.id)),
    );
    expect(run).toMatchObject({ status: "failed" });
    expect(run.error).toContain("Interrumpida");
  });
});

describe("scheduled inbound agent", () => {
  it("runs the inbound agent on its schedule: it attends what is waiting in its project", async () => {
    const other = await withTenant(db, tenant, async (tx) => {
      const [p] = await tx
        .insert(projects)
        .values({ orgId: tenant.orgId, name: "Recepción", timezone: "Europe/Madrid" })
        .returning();
      await tx.insert(inboundEvents).values({
        orgId: tenant.orgId,
        projectId: p.id,
        source: "form",
        eventType: "form.submitted",
        payload: { fields: { email: "lead@cliente.es", mensaje: "Hola" } },
      });
      return p.id;
    });
    const inbound = await addAgent(db, tenant, other, "inbound");
    await saveAgentInstructions(db, tenant, other, inbound.id, {
      instructions: "",
      schedule: { kind: "daily", time: "08:00" },
    });
    await setAgentEnabled(db, tenant, other, inbound.id, true);
    // Thursday 8 October 2026, 08:30 in Madrid.
    const now = new Date("2026-10-08T06:30:00Z");
    const { llm } = scriptedLlm(
      Array.from({ length: 5 }, () => ({ blocks: [{ type: "text" as const, text: "Hecho." }] })),
    );
    const report = await runDueAgents({ db, llmFor: async () => llm, gateway: gateway(), now: () => now });
    const run = report.runs.find((r) => r.projectId === other);
    expect(run?.result).toMatchObject({ outcomes: [{ status: "processed" }] });
  });
});
