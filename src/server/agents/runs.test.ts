import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { agentRuns, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { costBreakdown } from "../llm/client";
import { addAgent } from "../services/agents";
import { getRun, listRuns, monthStart, runTotals } from "./runs";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let other: TenantContext;
let projectId: string;

const MODEL = "claude-opus-5-5";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Registro");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const otherOrg = await seedOrg(db, "Otra");
  other = { orgId: otherOrg.orgId, actorType: "user", actorId: otherOrg.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(projects)
      .values({ orgId: tenant.orgId, name: "Swipoo", timezone: "Europe/Madrid" })
      .returning(),
  );
  projectId = p.id;
  await addAgent(db, tenant, projectId, "outbound", "b2b_consultative");
  await withTenant(db, tenant, (tx) =>
    tx.insert(agentRuns).values([
      {
        orgId: tenant.orgId,
        projectId,
        agentType: "outbound",
        trigger: "manual",
        status: "completed",
        model: MODEL,
        inputTokens: 100_000,
        outputTokens: 10_000,
        cacheReadTokens: 50_000,
        cacheWriteTokens: 20_000,
        webSearches: 5,
        // 0.4 + 0.2 + 0.01 + 0.1 + 0.05 = 0.76, plus 0.04 of first-contact drafts
        costUsd: 0.8,
        steps: [],
        startedAt: new Date("2026-10-05T10:00:00Z"),
        finishedAt: new Date("2026-10-05T10:02:00Z"),
      },
      {
        orgId: tenant.orgId,
        projectId,
        agentType: "outbound",
        trigger: "schedule",
        status: "completed",
        model: MODEL,
        inputTokens: 10_000,
        costUsd: 0.04,
        steps: [],
        startedAt: new Date("2026-09-20T10:00:00Z"),
        finishedAt: new Date("2026-09-20T10:00:30Z"),
      },
      {
        orgId: tenant.orgId,
        projectId,
        agentType: "copilot",
        trigger: "copilot",
        status: "running",
        model: MODEL,
        steps: [],
        startedAt: new Date("2026-10-06T10:00:00Z"),
      },
    ]),
  );
});

afterAll(async () => {
  await close();
});

describe("costBreakdown", () => {
  it("splits a run's cost by tokens and searches, the rest as «Otros»", () => {
    const lines = costBreakdown(
      MODEL,
      { input: 100_000, output: 10_000, cacheRead: 50_000, cacheWrite: 20_000, webSearches: 5 },
      0.8,
    );
    const by = Object.fromEntries(lines.map((l) => [l.key, l.usd]));
    expect(by.input).toBeCloseTo(0.4);
    expect(by.output).toBeCloseTo(0.2);
    expect(by.cache).toBeCloseTo(0.11);
    expect(by.search).toBeCloseTo(0.05);
    expect(by.other).toBeCloseTo(0.04);
    expect(lines.reduce((s, l) => s + l.usd, 0)).toBeCloseTo(0.8);
  });

  it("leaves out empty items and puts everything under the model when its prices are unknown", () => {
    expect(
      costBreakdown(
        MODEL,
        { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0 },
        0.004,
      ).map((l) => l.key),
    ).toEqual(["input"]);
    const unknown = costBreakdown(
      "mystery-1",
      { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, webSearches: 0 },
      0.3,
    );
    expect(unknown).toEqual([expect.objectContaining({ key: "other", label: "Modelo", usd: 0.3 })]);
  });
});

describe("runs log", () => {
  it("lists runs newest first, with label, duration and cost lines, page by page", async () => {
    const first = await listRuns(db, tenant, { limit: 2 });
    expect(first.runs.map((r) => r.agentType)).toEqual(["copilot", "outbound"]);
    expect(first.runs[0]).toMatchObject({ label: "Copilot", status: "running", durationMs: null });
    expect(first.runs[1]).toMatchObject({ projectName: "Swipoo", durationMs: 120_000, steps: 0 });
    expect(first.runs[1].cost.map((l) => l.key)).toEqual(["input", "output", "cache", "search", "other"]);
    expect(first.next).toEqual(new Date("2026-10-05T10:00:00Z"));
    const second = await listRuns(db, tenant, { limit: 2, before: first.next! });
    expect(second.runs.map((r) => r.trigger)).toEqual(["schedule"]);
    expect(second.next).toBeNull();
  });

  it("filters by agent and period and adds up the cost by agent", async () => {
    const outbound = await listRuns(db, tenant, { agentType: "outbound" });
    expect(outbound.runs).toHaveLength(2);
    const october = await runTotals(db, tenant, { since: new Date("2026-10-01T00:00:00Z") });
    expect(october.runs).toBe(2);
    expect(october.costUsd).toBeCloseTo(0.8);
    expect(october.byAgent[0]).toMatchObject({ agentType: "outbound", runs: 1, webSearches: 5 });
    const september = await runTotals(db, tenant, {
      since: new Date("2026-09-01T00:00:00Z"),
      until: new Date("2026-10-01T00:00:00Z"),
    });
    expect(september).toMatchObject({ runs: 1 });
    expect(september.costUsd).toBeCloseTo(0.04);
  });

  it("keeps each organization's runs to itself", async () => {
    expect((await listRuns(db, other)).runs).toEqual([]);
    const { runs } = await listRuns(db, tenant, { limit: 1 });
    expect(await getRun(db, other, runs[0].id)).toBeNull();
    expect((await getRun(db, tenant, runs[0].id))?.agentType).toBe("copilot");
  });

  it("knows where the month starts in a time zone", () => {
    const now = new Date("2026-10-31T23:30:00Z").getTime(); // already 1 November in Madrid
    expect(monthStart("Europe/Madrid", 0, now).getTime()).toBe(Date.parse("2026-10-31T23:00:00Z"));
    expect(monthStart("Europe/Madrid", -1, now).getTime()).toBe(Date.parse("2026-09-30T22:00:00Z"));
  });
});
