import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { lastToolResults, scriptedLlm } from "../../../tests/helpers/fake-llm";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import type { GatewayDeps } from "../gateway/gateway";
import { listProspects } from "../prospects/service";
import { addAgent, saveAgentInstructions, setAgentEnabled } from "../services/agents";
import { isDue, localClock, runDueAgents } from "./scheduler";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

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
});

describe("runDueAgents", () => {
  it("runs the prospecting agent when its time comes, and only once", async () => {
    await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
    await saveAgentInstructions(db, tenant, projectId, "outbound", {
      instructions: "Concesionarios de Andalucía.",
      schedule: { time: "08:00", days: [1, 2, 3, 4, 5] },
      settings: { prospectsPerRun: 2 },
    });
    const now = () => new Date("2026-10-07T06:30:00Z");

    // Not enabled yet: nothing runs.
    expect(await runDueAgents({ db, llm: scriptedLlm([]).llm, gateway: gateway(), now })).toEqual([]);
    await setAgentEnabled(db, tenant, projectId, "outbound", true);

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
                    fitScore: 85,
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
    const report = await runDueAgents({ db, llm, gateway: gateway(), now });
    expect(report).toHaveLength(1);
    expect(report[0].result).toMatchObject({ status: "completed", added: 1 });

    const system = (requests[0].system as { text: string }[])[0].text;
    expect(system).toContain("Concesionarios de Andalucía.");
    expect(system).toContain("Qué vendemos: Transferencias de vehículos");
    expect(requests[0].tools?.map((t) => ("name" in t ? t.name : t.type))).toEqual(
      expect.arrayContaining(["save_prospects", "check_prospects", "web_search", "web_fetch"]),
    );

    const { rows } = await listProspects(db, tenant, projectId);
    expect(rows.map((r) => [r.companyName, r.fitScore])).toEqual([["Autos García", 85]]);
    const runs = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentRuns).where(eq(agentRuns.projectId, projectId)),
    );
    expect(runs.map((r) => [r.agentType, r.trigger, r.status])).toEqual([
      ["outbound", "schedule", "completed"],
    ]);

    // Same day again: already ran.
    expect(await runDueAgents({ db, llm: scriptedLlm([]).llm, gateway: gateway(), now })).toEqual([]);
    const [config] = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentConfigs).where(eq(agentConfigs.projectId, projectId)),
    );
    expect(config.lastScheduledRunAt).toEqual(now());
  });
});
