import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../../tests/helpers/db";
import { scriptedLlm } from "../../../../tests/helpers/fake-llm";
import { runProspecting } from "../../agents/prospector";
import type { Db } from "../../db/client";
import { agentConfigs, agentEvents, projects } from "../../db/schema";
import { withTenant, type TenantContext } from "../../db/tenant";
import type { LlmRequest } from "../../llm/client";
import { addAgent } from "../../services/agents";
import { createBase, setAgentBase } from "../bases";
import { completionCost, countPendingCells, rowsToComplete } from "../complete";
import { getProspect, saveProspects } from "../service";
import { pickWebsite, runCompletionEngine } from "./engine";
import { siteFacts } from "./facts";
import {
  isPublicAddress,
  parseHtml,
  parseRobots,
  robotsAllow,
  siteReader,
  usefulSubpages,
  webUrl,
} from "./reader";

const HOME = `<html><head><title>Autos García · Concesionario en Málaga</title><script>var x = "no@leer.es";</script></head>
<body><nav><a href="/contacto">Contacto</a> <a href="/aviso-legal">Aviso legal</a> <a href="/blog/post">Blog</a>
<a href="https://www.facebook.com/autosgarcia">Facebook</a> <a href="https://www.linkedin.com/company/autos-garcia/">LinkedIn</a></nav>
<h1>Autos García</h1><p>Concesionario multimarca con m&aacute;s de 1.200 coches en stock.</p></body></html>`;
const CONTACT = `<html><body><h1>Contacto</h1><p>Llámanos al <a href="tel:+34952123456">952 12 34 56</a> o escribe a
<a href="mailto:ventas@autosgarcia.es">ventas@autosgarcia.es</a>.</p><p>Fecha: 2024-01-15. CP 29004.</p>
<img src="logo@2x.png"></body></html>`;
const LEGAL = `<html><body><p>Autos García S.L., CIF B-29123456, calle Larios 1, Málaga.</p></body></html>`;

/** A web of public pages: autosgarcia.es (robots.txt hides /privado), its copies and motorsur.es (down). */
function fakeWeb() {
  const pages: Record<string, { status: number; body: string; type?: string; location?: string }> = {
    "https://autosgarcia.es/": { status: 200, body: HOME },
    "https://autosgarcia.es/contacto": { status: 200, body: CONTACT },
    "https://autosgarcia.es/aviso-legal": { status: 200, body: LEGAL },
    "https://autosgarcia.es/robots.txt": {
      status: 200,
      body: "User-agent: *\nDisallow: /privado",
      type: "text/plain",
    },
    "http://autosgarcia.es/": { status: 301, body: "", location: "https://autosgarcia.es/" },
    "https://evil.es/": { status: 302, body: "", location: "http://127.0.0.1/admin" },
  };
  const seen: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    // garcia1.es, garcia2.es… are copies of autosgarcia.es.
    const url = String(input).replace(/^https:\/\/garcia\d+\.es/, "https://autosgarcia.es");
    seen.push(String(input));
    if (url.startsWith("https://motorsur.es")) throw new TypeError("fetch failed");
    const page = pages[url];
    if (!page) return new Response("no", { status: 404 });
    return new Response(page.body, {
      status: page.status,
      headers: {
        "content-type": page.type ?? "text/html; charset=utf-8",
        ...(page.location ? { location: page.location } : {}),
      },
    });
  }) as typeof fetch;
  return {
    seen,
    reader: {
      fetch: fetchFn,
      resolve: async (host: string) => (host === "127.0.0.1" ? ["127.0.0.1"] : ["93.184.216.34"]),
    },
  };
}

describe("reader", () => {
  it("only takes public web addresses", () => {
    expect(webUrl("autosgarcia.es")?.toString()).toBe("https://autosgarcia.es/");
    expect(webUrl("ftp://x.es")).toBeNull();
    expect(webUrl("http://localhost:3000")).toBeNull();
    expect(webUrl("https://user:pw@x.es")).toBeNull();
    expect(webUrl("https://x.es:8080")).toBeNull();
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "192.168.1.1",
      "172.20.0.1",
      "::1",
      "fd00::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("follows robots.txt, longest rule first", () => {
    const rules = parseRobots(
      "User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /privado\nAllow: /privado/publico\n",
    );
    expect(robotsAllow(rules, "/contacto")).toBe(true);
    expect(robotsAllow(rules, "/privado/x")).toBe(false);
    expect(robotsAllow(rules, "/privado/publico/x")).toBe(true);
    expect(
      robotsAllow(parseRobots("User-agent: SalesMateBot\nDisallow: /\nUser-agent: *\nDisallow:"), "/"),
    ).toBe(false);
  });

  it("turns HTML into text and finds the pages with contact and company data", () => {
    const page = parseHtml(HOME, new URL("https://autosgarcia.es/"));
    expect(page.title).toBe("Autos García · Concesionario en Málaga");
    expect(page.text).toContain("Concesionario multimarca con más de 1.200 coches");
    expect(page.text).not.toContain("no@leer.es");
    expect(usefulSubpages(page)).toEqual([
      "https://autosgarcia.es/contacto",
      "https://autosgarcia.es/aviso-legal",
    ]);
  });

  it("reads through redirects, refuses private addresses and pages robots.txt hides", async () => {
    const web = fakeWeb();
    const read = siteReader(web.reader);
    expect((await read("http://autosgarcia.es")).url).toBe("https://autosgarcia.es/");
    await expect(read("https://autosgarcia.es/privado/x")).rejects.toMatchObject({ code: "robots" });
    await expect(read("https://evil.es")).rejects.toMatchObject({ code: "blocked" });
    await expect(read("https://motorsur.es")).rejects.toMatchObject({ code: "network" });
    // robots.txt is asked once per site.
    expect(web.seen.filter((u) => u === "https://autosgarcia.es/robots.txt")).toHaveLength(1);
  });
});

describe("facts", () => {
  it("picks emails, phones, the CIF and social profiles out of the pages", () => {
    const base = new URL("https://autosgarcia.es/");
    const facts = siteFacts([
      parseHtml(HOME, base),
      parseHtml(CONTACT, new URL("/contacto", base)),
      parseHtml(LEGAL, new URL("/aviso-legal", base)),
    ]);
    expect(facts.emails).toEqual(["ventas@autosgarcia.es"]);
    expect(facts.phones).toEqual(["952 123 456"]);
    expect(facts.taxIds).toEqual(["B29123456"]);
    expect(facts.socials).toEqual([
      "https://www.facebook.com/autosgarcia",
      "https://www.linkedin.com/company/autos-garcia",
    ]);
  });

  it("takes as the company's site its own domain, never a directory", () => {
    const results = (urls: string[]) => ({
      website: null,
      results: urls.map((url) => ({ title: "", url, snippet: "" })),
    });
    expect(
      pickWebsite(
        "Autos García, S.L.",
        results(["https://www.paginasamarillas.es/autos-garcia", "https://www.autos-garcia.com/contacto"]),
      ),
    ).toBe("https://autos-garcia.com");
    expect(pickWebsite("Autos García", results(["https://www.einforma.com/autos-garcia"]))).toBeNull();
    expect(pickWebsite("Autos García", { website: "https://www.garciamotor.es/", results: [] })).toBe(
      "https://garciamotor.es",
    );
  });
});

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
      .values({ orgId: tenant.orgId, name: "Swipoo", description: "Transferencias de vehículos" })
      .returning(),
  );
  projectId = p.id;
});
afterAll(async () => close());

/** The small model's answer for a row: the email and phone of the site it was shown. */
function answer(req: LlmRequest) {
  const prompt = String(req.messages[0].content);
  const site = prompt.match(/\((https:\/\/[^)]+)\)/)?.[1] ?? "";
  return {
    blocks: [
      {
        type: "text" as const,
        text: JSON.stringify({
          cells: [
            { column: "email", value: "ventas@autosgarcia.es", source: `${site}contacto` },
            { column: "telefono", value: "952 123 456", source: "https://inventada.es" },
            { column: "empleados", value: "muchos", source: site },
          ],
          notFound: ["cif"],
        }),
      },
    ],
  };
}

describe("runCompletionEngine", () => {
  it("finds the site, reads its pages and fills the row once, with sources and its cost", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "Concesionarios",
      rowKind: "company",
      columns: [
        { name: "Email", type: "email" },
        { name: "Teléfono", type: "phone" },
        { name: "Empleados", type: "number" },
        { name: "CIF", type: "text" },
      ],
    });
    const { added } = await saveProspects(db, tenant, {
      baseId: base.id,
      items: [
        { companyName: "Autos García" },
        { companyName: "Motor Sur", website: "motorsur.es" },
        { companyName: "Sin Rastro" },
      ],
    });
    const [garcia, motor, nada] = added;
    const { llm, requests } = scriptedLlm([answer]);
    const searches: string[] = [];
    const web = fakeWeb();
    const work = await rowsToComplete(db, tenant, base.id, { limit: 100 });
    const result = await runCompletionEngine(
      {
        db,
        llm,
        reader: web.reader,
        search: async ({ query }) => {
          searches.push(query);
          return query.includes("García")
            ? {
                website: null,
                results: [{ title: "Autos García", url: "https://autosgarcia.es/", snippet: "" }],
              }
            : {
                website: null,
                results: [{ title: "", url: "https://www.paginasamarillas.es/x", snippet: "" }],
              };
        },
      },
      { ...tenant, actorType: "agent", actorId: "run" },
      { base, rows: work.rows, deadline: Date.now() + 120_000, context: "Transferencias" },
    );

    expect(Object.fromEntries(result.rows.map((r) => [r.id, r.status]))).toEqual({
      [garcia.id]: "completed",
      [motor.id]: "unreadable",
      [nada.id]: "no_site",
    });
    // Motor Sur has a website: no search for it.
    expect(searches.sort()).toEqual(["Autos García web oficial", "Sin Rastro web oficial"]);
    expect(requests).toHaveLength(1);
    const prompt = String(requests[0].messages[0].content);
    expect(prompt).toContain("Emails: ventas@autosgarcia.es");
    expect(prompt).toContain("CIF: B29123456");
    expect(prompt).toContain("### https://autosgarcia.es/contacto");
    expect(requests[0].output_config?.format).toMatchObject({ type: "json_schema" });

    const row = (await getProspect(db, tenant, base.id, garcia.id))!;
    expect(row.website).toBe("https://autosgarcia.es/");
    expect(row.data).toEqual({ email: "ventas@autosgarcia.es", telefono: "952 123 456" });
    expect(row.cellMeta.email).toMatchObject({ by: "agent", source: "https://autosgarcia.es/contacto" });
    // A source that isn't a page it read becomes the home page.
    expect(row.cellMeta.telefono).toMatchObject({ source: "https://autosgarcia.es/" });
    // «muchos» isn't a number, and the CIF wasn't given: both answered as not found.
    expect(row.cellMeta.empleados).toMatchObject({ notFound: true });
    expect(row.cellMeta.cif).toMatchObject({ notFound: true });
    expect(result).toMatchObject({ filled: 2, notFound: 2, searches: 2, pagesRead: 3 });
    expect(row.costUsd).toBeGreaterThan(0);
    expect(result.costUsd).toBeCloseTo(row.costUsd + 0.001, 6);
    // The rows it couldn't read keep their cells for the agent.
    expect(await countPendingCells(db, tenant, base.id, [motor.id, nada.id])).toBe(8);
  });
});

describe("«Completar vacíos» with the engine", () => {
  it("uses the small model, stops at the run's budget and queues the next batch", async () => {
    const base = await createBase(db, tenant, projectId, {
      name: "Muchas",
      rowKind: "company",
      columns: [{ name: "Email", type: "email" }],
    });
    await saveProspects(db, tenant, {
      baseId: base.id,
      items: Array.from({ length: 8 }, (_, i) => ({
        companyName: `García ${i + 1}`,
        website: `garcia${i + 1}.es`,
      })),
    });
    const agent = await addAgent(db, tenant, projectId, "prospecting", "b2b_consultative");
    await setAgentBase(db, tenant, projectId, agent.id, base.id);
    // A run cap below what one row costs (the form doesn't allow it; it makes the stop visible).
    await withTenant(db, tenant, (tx) =>
      tx
        .update(agentConfigs)
        .set({ settings: { mode: "complete", budget: { maxCostPerRunUsd: 0.0001 } } })
        .where(eq(agentConfigs.id, agent.id)),
    );
    const { llm, requests } = scriptedLlm(Array.from({ length: 6 }, () => answer));
    const gateway = { db, executor: { execute: async () => ({}) } };
    const result = await runProspecting({ db, llm, gateway, reader: fakeWeb().reader }, tenant, {
      agentId: agent.id,
      trigger: "manual",
      allPending: true,
    });
    // Six rows start at once; the budget stops the other two.
    expect(requests).toHaveLength(6);
    expect(requests.every((r) => r.model === "claude-haiku-4-5")).toBe(true);
    expect(result).toMatchObject({ status: "completed", completed: 6 });
    expect(result.summary).toContain("Ha completado 6 celdas en 6 filas");
    expect(result.summary).toContain("Quedan 2 celdas por completar");
    const queued = await withTenant(db, tenant, (tx) =>
      tx.select().from(agentEvents).where(eq(agentEvents.agentConfigId, agent.id)),
    );
    expect(queued.map((e) => e.kind)).toEqual(["continue"]);
    const cost = await completionCost(db, tenant, base.id);
    expect(cost.rows).toBe(6);
    expect(cost.usd).toBeCloseTo(result.costUsd, 6);
  });
});
