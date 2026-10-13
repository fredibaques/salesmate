import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../../tests/helpers/db";
import { scriptedLlm, type ScriptedTurn } from "../../../../tests/helpers/fake-llm";
import { mockFetch } from "../../../../tests/helpers/fetch";
import { runProspecting } from "../../agents/prospector";
import { createDataConnection } from "../../connectors/service";
import type { Db } from "../../db/client";
import { agentConfigs, agentEvents, projects, webPages } from "../../db/schema";
import { withSystem, withTenant, type TenantContext } from "../../db/tenant";
import type { LlmRequest } from "../../llm/client";
import { addAgent } from "../../services/agents";
import { createBase, setAgentBase } from "../bases";
import { listProspects, saveProspects } from "../service";
import { dbPageCache, PAGE_TTL_MS } from "./cache";
import { runDiscovery } from "./discover";
import { siteReader } from "./reader";

const HOME = `<html><head><title>Autos García · Concesionario en Málaga</title></head>
<body><a href="/contacto">Contacto</a><h1>Autos García</h1>
<p>Concesionario multimarca en Málaga con más de 1.200 coches de ocasión en stock y financiación propia.</p></body></html>`;
const CONTACT = `<html><body><h1>Contacto</h1><p>Escribe a <a href="mailto:ventas@autosgarcia.es">ventas@autosgarcia.es</a>.</p></body></html>`;
const WORKSHOP = `<html><head><title>Talleres Pérez</title></head><body><h1>Talleres Pérez</h1>
<p>Taller mecánico de chapa y pintura en Málaga: revisiones, ITV y neumáticos para todas las marcas.</p></body></html>`;

/** autosgarcia.es (a dealer), tallerperez.es (a workshop), motorsur.es (down). */
function fakeWeb() {
  const pages: Record<string, string> = {
    "https://autosgarcia.es/": HOME,
    "https://autosgarcia.es/contacto": CONTACT,
    "https://tallerperez.es/": WORKSHOP,
  };
  const seen: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith("https://motorsur.es")) throw new TypeError("fetch failed");
    const body = pages[url];
    return body
      ? new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
      : new Response("no", { status: 404 });
  }) as typeof fetch;
  return { seen, reader: { fetch: fetchFn, resolve: async () => ["93.184.216.34"] } };
}

/** Google: a directory, the dealer, the workshop, a site that's down, the project's own and one already in the table. */
const RESULTS = [
  "https://www.paginasamarillas.es/concesionarios/malaga",
  "https://www.autosgarcia.es/",
  "https://tallerperez.es/",
  "https://motorsur.es/",
  "https://swipoo.com/",
  "https://yaesta.es/",
].map((url) => ({ title: new URL(url).hostname, url, snippet: "" }));

const plan = (queries: string[]): ScriptedTurn => ({
  blocks: [{ type: "text", text: JSON.stringify({ queries }) }],
});

/** The small model's verdict: the dealer matches (with its email), the workshop doesn't. */
function verdict(req: LlmRequest): ScriptedTurn {
  const prompt = String(req.messages[0].content);
  const dealer = prompt.includes("Web: https://autosgarcia.es/");
  return {
    blocks: [
      {
        type: "text",
        text: JSON.stringify({
          matches: dealer,
          reason: dealer ? "Concesionario de coches de ocasión" : "Es un taller, no vende coches",
          companyName: dealer ? "Autos García" : "Talleres Pérez",
          cells: dealer
            ? [{ column: "email", value: "ventas@autosgarcia.es", source: "https://autosgarcia.es/contacto" }]
            : [],
          notFound: dealer ? ["ciudad"] : [],
        }),
      },
    ],
  };
}

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let projectId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Motor");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
  const [p] = await withTenant(db, tenant, (tx) =>
    tx
      .insert(projects)
      .values({
        orgId: tenant.orgId,
        name: "Swipoo",
        description: "Transferencias de vehículos para concesionarios",
        website: "https://swipoo.com",
      })
      .returning(),
  );
  projectId = p.id;
});
afterAll(async () => close());

async function dealersTable(name: string) {
  const base = await createBase(db, tenant, projectId, {
    name,
    rowKind: "company",
    columns: [
      { name: "Email", type: "email" },
      { name: "Ciudad", type: "text" },
    ],
  });
  await saveProspects(db, tenant, {
    baseId: base.id,
    items: [{ companyName: "Ya Está", website: "yaesta.es" }],
  });
  return base;
}

describe("runDiscovery", () => {
  it("plans new searches, reads each company site once and keeps the ones that match", async () => {
    const base = await dealersTable("Concesionarios");
    const { llm, requests } = scriptedLlm([
      plan(["concesionario coches ocasión Málaga", "Concesionarios Sevilla", "compraventa coches Málaga"]),
      verdict,
      verdict,
    ]);
    const searches: string[] = [];
    const web = fakeWeb();
    const result = await runDiscovery(
      {
        db,
        llm,
        reader: web.reader,
        search: async ({ query }) => {
          searches.push(query);
          return { website: null, results: RESULTS };
        },
      },
      { ...tenant, actorType: "agent", actorId: "run" },
      {
        base,
        agentConfigId: (await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative")).id,
        runId: crypto.randomUUID(),
        target: 5,
        deadline: Date.now() + 120_000,
        brief: "Proyecto: transferencias para concesionarios de coches",
        usedQueries: ["concesionarios sevilla"],
        ownSite: "https://swipoo.com",
      },
    );

    // The search already run is not repeated.
    expect(searches).toEqual(["concesionario coches ocasión Málaga", "compraventa coches Málaga"]);
    expect(result.queries).toEqual(searches);
    expect(String(requests[0].messages[0].content)).toContain("concesionarios sevilla");
    // Only the dealer and the workshop are judged: not the directory, the project's own site,
    // the row already in the table, the site that's down, nor the same sites again.
    expect(requests).toHaveLength(3);
    expect(web.seen.some((u) => u.includes("paginasamarillas") || u.includes("swipoo"))).toBe(false);
    expect(result).toMatchObject({ added: 1, examined: 2, searches: 2 });
    expect(result.steps.filter((s) => "name" in s && s.name === "evaluar_web")).toHaveLength(2);

    const { rows } = await listProspects(db, tenant, base.id);
    const garcia = rows.find((r) => r.companyName === "Autos García")!;
    expect(garcia.website).toBe("https://autosgarcia.es/");
    expect(garcia.data).toEqual({ email: "ventas@autosgarcia.es" });
    expect(garcia.cellMeta.email).toMatchObject({ source: "https://autosgarcia.es/contacto" });
    expect(garcia.cellMeta.ciudad).toMatchObject({ notFound: true });
    expect(garcia.costUsd).toBeGreaterThan(0);
    expect(rows.map((r) => r.companyName).sort()).toEqual(["Autos García", "Ya Está"]);
  });
});

describe("prospecting with Serper connected", () => {
  it("finds new companies without the agent and remembers the searches", async () => {
    const base = await dealersTable("Concesionarios 2");
    const agent = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
    await setAgentBase(db, tenant, projectId, agent.id, base.id);
    const { fetch } = mockFetch({
      "POST https://google.serper.dev/search": () => ({
        organic: RESULTS.map((r) => ({ title: r.title, link: r.url, snippet: "" })),
      }),
    });
    await createDataConnection({ db, fetch }, tenant, {
      provider: "serper",
      label: "Serper",
      apiKey: "key-1234567890abcd",
    });
    const { llm, requests } = scriptedLlm([plan(["concesionario Málaga"]), verdict, verdict]);
    const result = await runProspecting(
      {
        db,
        llm,
        gateway: { db, executor: { execute: async () => ({}) } },
        connectors: { fetch },
        reader: fakeWeb().reader,
      },
      tenant,
      // The person asks for 5 new rows.
      { agentId: agent.id, trigger: "manual", wanted: 5 },
    );

    // Three calls to the small model, none with tools: the agent loop didn't run.
    expect(requests).toHaveLength(3);
    expect(requests.every((r) => r.model === "claude-haiku-4-5" && !r.tools?.length)).toBe(true);
    expect(result).toMatchObject({ status: "completed", added: 1 });
    expect(result.summary).toContain(
      "Ha encontrado 1 empresa nueva revisando 2 webs (1 búsquedas en Google)",
    );
    const [config] = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentConfigs).where(eq(agentConfigs.id, agent.id)),
    );
    expect(config.settings.discovery?.usedQueries).toEqual(["concesionario Málaga"]);
    // It found 1 of the 5 asked for: the other 4 are queued for the next run.
    expect(result.summary).toContain("Faltan 4 de las 5 filas pedidas");
    const queued = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentEvents).where(eq(agentEvents.agentConfigId, agent.id)),
    );
    expect(queued.map((e) => [e.kind, e.payload])).toEqual([["continue", { find: 4 }]]);

    // The next run looks for those 4 (not «Completar vacíos»); with nothing new, it stops asking.
    await withTenant(db, tenant, (tx) =>
      tx.delete(agentEvents).where(eq(agentEvents.agentConfigId, agent.id)),
    );
    const next = scriptedLlm([plan(["compraventa coches Málaga"])]);
    const again = await runProspecting(
      {
        db,
        llm: next.llm,
        gateway: { db, executor: { execute: async () => ({}) } },
        connectors: { fetch },
        reader: fakeWeb().reader,
      },
      tenant,
      { agentId: agent.id, trigger: "event", events: [{ kind: "continue", payload: { find: 4 } }] },
    );
    expect(String(next.requests[0].messages[0].content)).toContain("concesionario Málaga");
    expect(again).toMatchObject({ status: "completed", added: 0 });
    const after = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentEvents).where(eq(agentEvents.agentConfigId, agent.id)),
    );
    expect(after).toEqual([]);
  });
});

describe("page cache", () => {
  it("keeps the pages read for 30 days, so a site is read once", async () => {
    let now = Date.now();
    const cache = dbPageCache(db, () => now);
    const web = fakeWeb();
    const read = siteReader({ ...web.reader, cache });
    const first = await read("https://autosgarcia.es/");
    expect(first.cached).toBeFalsy();
    const again = await read("https://autosgarcia.es/");
    expect(again).toMatchObject({ url: "https://autosgarcia.es/", title: first.title, cached: true });
    expect(web.seen.filter((u) => u === "https://autosgarcia.es/")).toHaveLength(1);
    const [row] = await withSystem(db, (tx) =>
      tx.select().from(webPages).where(eq(webPages.url, "https://autosgarcia.es/")),
    );
    expect(row.text).toContain("Concesionario multimarca");

    // After 30 days it's read again.
    now += PAGE_TTL_MS + 1;
    expect((await read("https://autosgarcia.es/")).cached).toBeFalsy();
    expect(web.seen.filter((u) => u === "https://autosgarcia.es/")).toHaveLength(2);
  });
});
