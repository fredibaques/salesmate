import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { mockFetch } from "../../../tests/helpers/fetch";
import type { Db } from "../db/client";
import { actions, knowledgeSources, prospectBases, prospects, projects } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { proposeAction } from "../gateway/gateway";
import { importFromGoogle, parseGoogleUrl } from "../knowledge/google-import";
import { saveProspects } from "../prospects/service";
import { ConnectorExecutor } from "./executor";
import { createGoogleClient, googleProvider } from "./google";
import { getProvider } from "./registry";
import { createWorkspaceConnection, saveGoogleConnection, setTaskTarget } from "./service";
import { ConnectorError, describeConnectorError } from "./types";
import { createAirtableClient, createMondayClient, createTrelloClient } from "./workspace";

const ctxOf = (fetch: typeof globalThis.fetch) => ({ fetch });
const AIRTABLE_TOKEN = "patAAAAAAAAAAAAAA.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const TRELLO = { key: "k".repeat(32), token: "t".repeat(64) };
const MONDAY_TOKEN = "eyJhbGciOiJIUzI1NiJ9.monday-token-de-prueba";

const header = ["Empresa", "Web", "Ciudad"];
const rows = [
  ["Autos García", "autosgarcia.es", "Málaga"],
  ["Motor Sur", "", "Sevilla"],
];

describe("Airtable", () => {
  it("creates a table in the base with unique text fields and adds the rows in batches of 10", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://api.airtable.com/v0/meta/bases/appBASE/tables": () => ({ id: "tblNEW" }),
      "POST https://api.airtable.com/v0/appBASE/tblNEW": () => ({ records: [] }),
    });
    const many = Array.from({ length: 12 }, (_, i) => [`Empresa ${i}`, "", ""]);
    const result = await createAirtableClient({ token: AIRTABLE_TOKEN }, ctxOf(fetch))["table.export"]({
      name: "Concesionarios",
      header: ["Empresa", "Web", "Web", ""],
      rows: many,
      target: "appBASE",
    });
    expect(result).toEqual({ url: "https://airtable.com/appBASE/tblNEW", count: 12 });
    expect(requests[0].headers.authorization).toBe(`Bearer ${AIRTABLE_TOKEN}`);
    const table = requests[0].body as { name: string; fields: { name: string; type: string }[] };
    expect(table.name).toMatch(/^Concesionarios · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(table.fields).toEqual([
      { name: "Empresa", type: "singleLineText" },
      { name: "Web", type: "multilineText" },
      { name: "Web 2", type: "multilineText" },
      { name: "Campo", type: "multilineText" },
    ]);
    const batches = requests.slice(1).map((r) => (r.body as { records: unknown[] }).records.length);
    expect(batches).toEqual([10, 2]);
    expect((requests[1].body as { typecast: boolean }).typecast).toBe(true);
  });

  it("asks for a base", async () => {
    const { fetch } = mockFetch({});
    await expect(
      createAirtableClient({ token: AIRTABLE_TOKEN }, ctxOf(fetch))["table.export"]({
        name: "x",
        header,
        rows,
      }),
    ).rejects.toThrow("Elige la base de Airtable.");
  });
});

describe("Trello", () => {
  it("lists every list of the open boards and makes one card per row", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://api.trello.com/1/members/me/boards": () => [
        {
          id: "b1",
          name: "Ventas",
          lists: [
            { id: "l1", name: "Por llamar" },
            { id: "l2", name: "Hecho" },
          ],
        },
      ],
      "POST https://api.trello.com/1/cards": () => ({ id: "c1", url: "https://trello.com/c/c1" }),
    });
    const client = createTrelloClient(TRELLO, ctxOf(fetch));
    expect(await client["export.targets"]()).toEqual([
      { id: "l1", label: "Ventas › Por llamar" },
      { id: "l2", label: "Ventas › Hecho" },
    ]);
    expect(await client["table.export"]({ name: "Concesionarios", header, rows, target: "l1" })).toEqual({
      url: null,
      count: 2,
    });
    const card = new URL(requests[1].url);
    expect(card.searchParams.get("key")).toBe(TRELLO.key);
    expect(card.searchParams.get("idList")).toBe("l1");
    expect(card.searchParams.get("name")).toBe("Autos García");
    expect(card.searchParams.get("desc")).toBe("Web: autosgarcia.es\nCiudad: Málaga");
    // Empty fields are left out.
    expect(new URL(requests[2].url).searchParams.get("desc")).toBe("Ciudad: Sevilla");
  });

  it("stops at 100 cards", async () => {
    const { fetch, requests } = mockFetch({ "POST https://api.trello.com/1/cards": () => ({ id: "c" }) });
    const many = Array.from({ length: 130 }, (_, i) => [`Empresa ${i}`]);
    const result = await createTrelloClient(TRELLO, ctxOf(fetch))["table.export"]({
      name: "x",
      header: ["Empresa"],
      rows: many,
      target: "l1",
    });
    expect(result.count).toBe(100);
    expect(requests).toHaveLength(100);
  });
});

describe("monday.com", () => {
  it("creates an item per row with the details as an update, and reports GraphQL errors", async () => {
    let failing = false;
    const { fetch, requests } = mockFetch({
      "POST https://api.monday.com/v2": (req) => {
        if (failing) return { errors: [{ message: "Board not found" }] };
        const query = (req.body as { query: string }).query;
        return query.includes("create_item")
          ? { data: { create_item: { id: "991" } } }
          : { data: { create_update: { id: "u1" } } };
      },
    });
    const client = createMondayClient({ token: MONDAY_TOKEN }, ctxOf(fetch));
    expect(
      await client["task.create"]({ title: "Llamar a Ana", body: "Mañana\na las 10", target: "123" }),
    ).toEqual({
      id: "991",
      url: null,
    });
    expect(requests[0].headers.authorization).toBe(MONDAY_TOKEN);
    expect(requests[0].headers["api-version"]).toBe("2024-10");
    expect(requests[0].body).toMatchObject({ variables: { board: "123", name: "Llamar a Ana" } });
    expect(requests[1].body).toMatchObject({ variables: { item: "991", body: "Mañana<br>a las 10" } });

    failing = true;
    await expect(client["export.targets"]()).rejects.toThrow("monday.com: Board not found");
  });
});

describe("errors in words", () => {
  it("turns HTTP failures into a sentence and keeps messages already written for people", () => {
    expect(
      describeConnectorError(new ConnectorError("Trello GET members/me/boards failed with HTTP 401", 401)),
    ).toMatch(/^Trello no acepta las credenciales guardadas/);
    expect(describeConnectorError(new ConnectorError("monday.com failed with HTTP 429", 429))).toMatch(
      /^monday\.com ha limitado las peticiones/,
    );
    expect(describeConnectorError(new ConnectorError("Elige la base de Airtable."))).toBe(
      "Elige la base de Airtable.",
    );
  });
});

describe("Google Docs, Sheets and Meet", () => {
  const creds = { refreshToken: "r", accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope: "" };
  const oauth = { clientId: "cid", clientSecret: "secret" };

  it("reads a doc as text, with tables as rows", async () => {
    const { fetch } = mockFetch({
      "GET https://docs.googleapis.com/v1/documents/DOC1": () => ({
        title: "Tarifas 2026",
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: "Precios\n" } }] } },
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      { content: [{ paragraph: { elements: [{ textRun: { content: "Básico\n" } }] } }] },
                      { content: [{ paragraph: { elements: [{ textRun: { content: "49 €\n" } }] } }] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      }),
    });
    const doc = await createGoogleClient(creds, { fetch, oauth })["docs.read"]({ documentId: "DOC1" });
    expect(doc).toEqual({ title: "Tarifas 2026", text: "Precios\nBásico | 49 €" });
  });

  it("reads the first sheet and writes a table to a new spreadsheet", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://sheets.googleapis.com/v4/spreadsheets/SHEET1?": () => ({
        properties: { title: "Clientes" },
        sheets: [{ properties: { title: "Hoja 1" } }, { properties: { title: "Otra" } }],
      }),
      "GET https://sheets.googleapis.com/v4/spreadsheets/SHEET1/values/": () => ({
        values: [
          ["Nombre", "Gasto"],
          ["Ana", 120],
        ],
      }),
      "POST https://sheets.googleapis.com/v4/spreadsheets": () => ({
        spreadsheetId: "NEW",
        spreadsheetUrl: "https://docs.google.com/spreadsheets/d/NEW/edit",
      }),
      "PUT https://sheets.googleapis.com/v4/spreadsheets/NEW/values/": () => ({}),
    });
    const client = createGoogleClient(creds, { fetch, oauth });
    expect(await client["sheets.read"]({ spreadsheetId: "SHEET1" })).toEqual({
      title: "Clientes",
      sheetTitle: "Hoja 1",
      rows: [
        ["Nombre", "Gasto"],
        ["Ana", "120"],
      ],
    });
    expect(decodeURIComponent(requests[1].url)).toContain("/values/'Hoja 1'");

    const exported = await client["table.export"]({ name: "Concesionarios", header, rows });
    expect(exported).toEqual({ url: "https://docs.google.com/spreadsheets/d/NEW/edit", count: 2 });
    expect(requests[3]).toMatchObject({ method: "PUT", body: { values: [header, ...rows] } });
    expect(requests[3].url).toContain("valueInputOption=RAW");
  });

  it("books a Google Meet call when the meeting has no place", async () => {
    const { fetch, requests } = mockFetch({
      "POST https://www.googleapis.com/calendar/v3/calendars/": () => ({
        id: "ev1",
        htmlLink: "https://calendar.google.com/ev1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
      }),
    });
    const client = createGoogleClient(creds, { fetch, oauth });
    const booking = {
      calendarId: "yo@acme.com",
      start: "2026-10-09T09:00:00Z",
      end: "2026-10-09T09:30:00Z",
      title: "Demo",
      description: "",
      attendees: [{ email: "ana@cliente.com" }],
    };
    expect(await client["calendar.book"](booking)).toMatchObject({
      eventId: "ev1",
      meetLink: "https://meet.google.com/abc-defg-hij",
    });
    expect(requests[0].url).toContain("conferenceDataVersion=1");
    expect(requests[0].body).toMatchObject({
      conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });

    await client["calendar.book"]({ ...booking, location: "Calle Larios 1, Málaga" });
    expect(requests[1].url).not.toContain("conferenceDataVersion");
    expect(requests[1].body).not.toHaveProperty("conferenceData");
  });

  it("grants Docs and Sheets capabilities from the stored scopes", () => {
    const provider = googleProvider(oauth);
    expect(provider.capabilitiesFor({ read: ["docs", "sheets"], write: ["sheets"] })).toEqual([
      "docs.read",
      "sheets.read",
      "table.export",
    ]);
  });

  it("recognises Docs and Sheets links", () => {
    expect(parseGoogleUrl("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit")).toEqual({
      kind: "doc",
      id: "1AbCdEfGhIjKlMnOpQrStUvWx",
    });
    expect(
      parseGoogleUrl("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit#gid=0"),
    ).toEqual({
      kind: "sheet",
      id: "1AbCdEfGhIjKlMnOpQrStUvWx",
    });
    expect(parseGoogleUrl("https://example.com/doc")).toBeNull();
  });
});

describe("exports, tasks and imports end to end", () => {
  let db: Db;
  let close: () => Promise<void>;
  let tenant: TenantContext;
  let projectId: string;
  let baseId: string;

  const google = googleProvider({ clientId: "cid", clientSecret: "secret" });
  const providers = (id: string) => (id === "google" ? (google as never) : getProvider(id));

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const seeded = await seedOrg(db, "Export");
    tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
    ({ projectId, baseId } = await withTenant(db, tenant, async (tx) => {
      const [p] = await tx.insert(projects).values({ orgId: tenant.orgId, name: "Ventas" }).returning();
      const [base] = await tx
        .insert(prospectBases)
        .values({
          orgId: tenant.orgId,
          projectId: p.id,
          name: "Concesionarios",
          columns: [{ id: "city", name: "Ciudad", type: "text", filledBy: "agent" }],
        })
        .returning();
      return { projectId: p.id, baseId: base.id };
    }));
    await saveProspects(db, tenant, {
      baseId,
      items: [
        { companyName: "Autos García", website: "autosgarcia.es", fields: { city: "Málaga" } },
        { companyName: "Motor Sur", website: "motorsur.es", fields: { city: "Sevilla" } },
      ],
    });
  });
  afterAll(async () => close());

  it("connects Trello after checking the token, and creates tasks in the chosen list", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://api.trello.com/1/members/me?": () => ({ username: "fredi" }),
      "POST https://api.trello.com/1/cards": () => ({ id: "c9", url: "https://trello.com/c/c9" }),
    });
    const conn = await createWorkspaceConnection({ db, fetch }, tenant, {
      provider: "trello",
      label: "Trello del equipo",
      ...TRELLO,
    });
    expect(conn).toMatchObject({ provider: "trello", accountRef: "fredi", writeScopes: ["workspace"] });
    expect(conn.credentialsEncrypted).not.toContain(TRELLO.token);

    const deps = { db, executor: new ConnectorExecutor({ db, fetch, providers }) };
    const task = {
      projectId,
      type: "task.create",
      payload: { connectionId: conn.id, title: "Llamar a Ana" },
    };
    const failed = await proposeAction(deps, tenant, { ...task, idempotencyKey: "t1" });
    expect(failed.outcome).toBe("failed");

    await setTaskTarget({ db }, tenant, conn.id, { id: "l1", label: "Ventas › Por llamar" });
    const done = await proposeAction(deps, tenant, { ...task, idempotencyKey: "t2" });
    expect(done.outcome).toBe("executed");
    expect(done.action.result).toEqual({ id: "c9", url: "https://trello.com/c/c9" });
    expect(new URL(requests.at(-1)!.url).searchParams.get("idList")).toBe("l1");
  });

  it("exports the new rows to Airtable and marks them as exported", async () => {
    const { fetch, requests } = mockFetch({
      "GET https://api.airtable.com/v0/meta/whoami": () => ({ email: "fredi@example.com" }),
      "POST https://api.airtable.com/v0/meta/bases/appBASE/tables": () => ({ id: "tblNEW" }),
      "POST https://api.airtable.com/v0/appBASE/tblNEW": () => ({ records: [] }),
    });
    const conn = await createWorkspaceConnection({ db, fetch }, tenant, {
      provider: "airtable",
      label: "Airtable",
      token: AIRTABLE_TOKEN,
    });
    const result = await proposeAction(
      { db, executor: new ConnectorExecutor({ db, fetch, providers }) },
      tenant,
      {
        projectId,
        type: "table.export",
        payload: {
          connectionId: conn.id,
          baseId,
          include: "pending",
          target: "appBASE",
          destination: "Airtable",
        },
      },
    );
    expect(result.outcome).toBe("executed");
    expect(result.action.result).toEqual({ url: "https://airtable.com/appBASE/tblNEW", count: 2 });
    const records = (requests.at(-1)!.body as { records: { fields: Record<string, string> }[] }).records;
    expect(records[0].fields).toMatchObject({
      Empresa: "Autos García",
      Web: "autosgarcia.es",
      Ciudad: "Málaga",
    });

    const statuses = await withTenant(db, tenant, (tx) =>
      tx.select({ status: prospects.status }).from(prospects).where(eq(prospects.baseId, baseId)),
    );
    expect(statuses.map((s) => s.status)).toEqual(["exported", "exported"]);

    // Nothing new left: exporting the new rows again writes nothing.
    const again = await proposeAction(
      { db, executor: new ConnectorExecutor({ db, fetch, providers }) },
      tenant,
      {
        projectId,
        type: "table.export",
        payload: { connectionId: conn.id, baseId, include: "pending", target: "appBASE" },
        idempotencyKey: "again",
      },
    );
    expect(again.action.result).toEqual({ url: null, count: 0 });
    const [recorded] = await withTenant(db, tenant, (tx) =>
      tx.select().from(actions).where(eq(actions.id, result.action.id)),
    );
    expect(recorded.status).toBe("succeeded");
  });

  it("imports a Google Doc and a Google Sheet into the project's knowledge, trying each account", async () => {
    const scope = [
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/documents.readonly",
      "https://www.googleapis.com/auth/spreadsheets",
    ].join(" ");
    const credentials = { refreshToken: "r", accessToken: "tok", expiresAt: Date.now() + 3_600_000, scope };
    await saveGoogleConnection({ db }, tenant, {
      email: "otra@acme.com",
      name: null,
      credentials: { ...credentials, accessToken: "tok-otra" },
      ownerUserId: tenant.actorId!,
    });
    const conn = await saveGoogleConnection({ db }, tenant, {
      email: "yo@acme.com",
      name: null,
      credentials,
      ownerUserId: tenant.actorId!,
    });
    expect(conn).toMatchObject({ readScopes: ["calendar", "docs", "sheets"], writeScopes: ["sheets"] });

    const allowed = (req: { headers: Record<string, string> }) => req.headers.authorization === "Bearer tok";
    const denied = () => new Response(JSON.stringify({ error: { code: 403 } }), { status: 403 });
    const { fetch } = mockFetch({
      "GET https://docs.googleapis.com/v1/documents/": (req) =>
        allowed(req)
          ? {
              title: "Argumentario",
              body: {
                content: [{ paragraph: { elements: [{ textRun: { content: "Somos rápidos.\n" } }] } }],
              },
            }
          : denied(),
      "GET https://sheets.googleapis.com/v4/spreadsheets/": (req) => {
        if (!allowed(req)) return denied();
        return req.url.includes("/values/")
          ? { values: [["Servicio", "Precio"], ["Transferencia", "49"], [""]] }
          : { properties: { title: "Tarifas" }, sheets: [{ properties: { title: "2026" } }] };
      },
    });
    const deps = { db, connectors: { fetch, providers } };
    const doc = await importFromGoogle(deps, tenant, {
      projectId,
      url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWx/edit",
    });
    expect(doc).toEqual({ name: "Argumentario", kind: "doc" });
    const sheet = await importFromGoogle(deps, tenant, {
      projectId,
      url: "https://docs.google.com/spreadsheets/d/1ZyXwVuTsRqPoNmLkJiHgFeDc/edit",
    });
    expect(sheet).toEqual({ name: "Tarifas · 2026", kind: "sheet", tables: 1 });
    const sources = await withTenant(db, tenant, (tx) =>
      tx
        .select({ name: knowledgeSources.name })
        .from(knowledgeSources)
        .where(eq(knowledgeSources.projectId, projectId)),
    );
    expect(sources.map((s) => s.name).sort()).toEqual(["Argumentario", "Tarifas · 2026"]);

    await expect(importFromGoogle(deps, tenant, { projectId, url: "https://example.com" })).rejects.toThrow(
      "Pega el enlace",
    );
  });
});
