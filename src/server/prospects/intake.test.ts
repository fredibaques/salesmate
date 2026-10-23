import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import type { TenantContext } from "../db/tenant";
import { createBase, getBase } from "./bases";
import { intakeKeyOf, intakeRow, parseIntakeBody, setIntakeKey } from "./intake";
import { listProspects } from "./service";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Intake");
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: seeded.userId };
});
afterAll(async () => close());

describe("rows from a web form", () => {
  it("need the table's key, fill columns by name and the fixed fields by their usual names", async () => {
    const base = await createBase(db, tenant, null, {
      name: "Contactos web",
      rowKind: "person",
      columns: [
        { name: "Email", type: "email", filledBy: "person" },
        { name: "Mensaje", type: "long", filledBy: "person" },
        { name: "Interés", type: "select", options: ["Comprar", "Vender"], filledBy: "person" },
      ],
    });
    const fields = {
      nombre: "Ana Ruiz",
      empresa: "Autos Ruiz",
      web: "https://autosruiz.es",
      correo: "ana@autosruiz.es",
      mensaje: "Quiero saber precios",
      interes: "Vender",
      utm_source: "google",
    };
    // Closed until the table has a key.
    expect((await intakeRow(db, { baseId: base.id, key: "x", fields })).status).toBe("unauthorized");
    const { intakeKey } = await setIntakeKey(db, tenant, base.id);
    expect(intakeKey).toMatch(/^[\w-]{20,}$/);
    expect((await intakeRow(db, { baseId: base.id, key: "otra-clave", fields })).status).toBe("unauthorized");

    const added = await intakeRow(db, { baseId: base.id, key: intakeKey, fields });
    expect(added).toMatchObject({ status: "added", ignored: ["utm_source"] });
    const [row] = (await listProspects(db, tenant, base.id, {})).rows;
    expect(row).toMatchObject({
      personName: "Ana Ruiz",
      companyName: "Autos Ruiz",
      website: "https://autosruiz.es",
    });
    const ids = Object.fromEntries(base.columns.map((c) => [c.name, c.id]));
    expect(row.data).toMatchObject({
      [ids.Email]: "ana@autosruiz.es",
      [ids.Mensaje]: "Quiero saber precios",
      [ids["Interés"]]: "Vender",
    });

    // The same person again is the same row.
    expect((await intakeRow(db, { baseId: base.id, key: intakeKey, fields })).status).toBe("duplicate");

    // A new key replaces the old one; closing it stops the form.
    const renewed = await setIntakeKey(db, tenant, base.id);
    expect((await intakeRow(db, { baseId: base.id, key: intakeKey, fields })).status).toBe("unauthorized");
    await setIntakeKey(db, tenant, base.id, false);
    expect((await intakeRow(db, { baseId: base.id, key: renewed.intakeKey, fields })).status).toBe(
      "unauthorized",
    );
  });

  it("is a public endpoint that answers JSON, or sends the visitor back to the site", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/tables/[baseId]/rows/route");
    const clientModule = await import("../db/client");
    vi.spyOn(clientModule, "getDb").mockReturnValue(db);
    const base = await createBase(db, tenant, null, { name: "Leads", rowKind: "company", columns: [] });
    const { intakeKey } = await setIntakeKey(db, tenant, base.id);
    const ctx = { params: Promise.resolve({ baseId: base.id }) };

    const json = await POST(
      new Request(`http://x/api/tables/${base.id}/rows`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-salesmate-key": intakeKey! },
        body: JSON.stringify({ empresa: "Talleres Pérez", web: "talleresperez.es" }),
      }),
      ctx as never,
    );
    expect(json.status).toBe(201);
    expect(await json.json()).toMatchObject({ ok: true, ignored: [] });

    const form = new URLSearchParams({
      _key: intakeKey!,
      _redirect: "https://mi-web.es/gracias",
      empresa: "Motor Sur",
    });
    const redirected = await POST(
      new Request(`http://x/api/tables/${base.id}/rows`, { method: "POST", body: form }),
      ctx as never,
    );
    expect(redirected.status).toBe(303);
    expect(redirected.headers.get("location")).toBe("https://mi-web.es/gracias");

    const denied = await POST(
      new Request(`http://x/api/tables/${base.id}/rows`, {
        method: "POST",
        body: new URLSearchParams({ empresa: "X" }),
      }),
      ctx as never,
    );
    expect(denied.status).toBe(401);
    expect((await listProspects(db, tenant, base.id, {})).rows.map((r) => r.companyName).sort()).toEqual([
      "Motor Sur",
      "Talleres Pérez",
    ]);
  });

  it("takes the key and the body the way most tools send them", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/tables/[baseId]/rows/route");
    const clientModule = await import("../db/client");
    vi.spyOn(clientModule, "getDb").mockReturnValue(db);
    const base = await createBase(db, tenant, null, {
      name: "Demos",
      rowKind: "person",
      columns: [{ name: "Email", type: "email", filledBy: "person" }],
    });
    const { intakeKey } = await setIntakeKey(db, tenant, base.id);
    const ctx = { params: Promise.resolve({ baseId: base.id }) };
    const post = (init: RequestInit, query = "") =>
      POST(
        new Request(`http://x/api/tables/${base.id}/rows${query}`, { method: "POST", ...init }),
        ctx as never,
      );

    // A bearer token, and JSON sent as plain text, nested the way some tools do.
    const bearer = await post({
      headers: { authorization: `Bearer ${intakeKey}`, "content-type": "text/plain" },
      body: JSON.stringify({ lead: { nombre: "Eva Sanz", email: "eva@flotas.es" }, source: "demo" }),
    });
    expect(bearer.status).toBe(201);
    expect(await bearer.json()).toMatchObject({ ignored: ["source"] });
    // The tool's own token in Authorization doesn't hide the table's key elsewhere, quoted.
    const both = await post({
      headers: { authorization: "Bearer token-de-la-herramienta", "x-api-key": `"${intakeKey}"` },
      body: JSON.stringify({ nombre: "Marta Gil" }),
    });
    expect(both.status).toBe(201);
    // The key in a «key» field is the key, not a value of the row.
    const field = await post({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: intakeKey, name: "Luis Gil" }),
    });
    expect(field.status).toBe(201);
    expect(await field.json()).toMatchObject({ ignored: [] });
    const rows = (await listProspects(db, tenant, base.id, { sort: "person", dir: "asc" })).rows;
    expect(rows.map((r) => [r.personName, r.data[base.columns[0].id] ?? null])).toEqual([
      ["Eva Sanz", "eva@flotas.es"],
      ["Luis Gil", null],
      ["Marta Gil", null],
    ]);
  });

  it("notes on the table why a submission didn't add a row, without its values", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/tables/[baseId]/rows/route");
    const clientModule = await import("../db/client");
    vi.spyOn(clientModule, "getDb").mockReturnValue(db);
    const base = await createBase(db, tenant, null, { name: "Rechazos", rowKind: "person", columns: [] });
    const ctx = { params: Promise.resolve({ baseId: base.id }) };
    const post = (init: RequestInit) =>
      POST(new Request(`http://x/api/tables/${base.id}/rows`, { method: "POST", ...init }), ctx as never);
    const json = (body: unknown, headers: Record<string, string> = {}) => ({
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

    expect((await post(json({ nombre: "Ana" }))).status).toBe(401); // closed
    const { intakeKey } = await setIntakeKey(db, tenant, base.id);
    expect((await post(json({ nombre: "Ana", email: "ana@x.es" }))).status).toBe(401);
    expect((await post(json({ nombre: "Ana" }, { "x-salesmate-key": "vieja" }))).status).toBe(401);
    expect((await post({ headers: { "content-type": "application/json" }, body: "{roto" })).status).toBe(400);
    expect((await post(json({ nombre: "Ana" }, { "x-salesmate-key": intakeKey! }))).status).toBe(201);
    expect((await post(json({ nombre: "Ana" }, { "x-salesmate-key": intakeKey! }))).status).toBe(200);

    const log = (await getBase(db, tenant, base.id))!.intakeLog;
    expect(log.map((a) => a.outcome)).toEqual([
      "duplicate",
      "invalid_body",
      "wrong_key",
      "missing_key",
      "closed",
    ]);
    expect(log[3].fields).toEqual(["nombre", "email"]);
    expect(JSON.stringify(log)).not.toContain("ana@x.es");
    // A wrong key says where it came from and its length, never the key.
    expect(log[2].message).toBe(
      `cabecera x-salesmate-key: 5 caracteres, empieza distinto. La de la tabla tiene ${intakeKey!.length} caracteres.`,
    );
    expect(JSON.stringify(log)).not.toContain("vieja");
  });
});

describe("reading a submission", () => {
  it("reads JSON whatever its type says, urlencoded fields, and flattens nested objects", () => {
    expect(parseIntakeBody('{"a":1,"contact":{"email":"x@y.es","a":2}}', "text/plain")).toEqual({
      a: 1,
      email: "x@y.es",
    });
    expect(parseIntakeBody("nombre=Ana&tag=a&tag=b", "application/x-www-form-urlencoded")).toEqual({
      nombre: "Ana",
      tag: ["a", "b"],
    });
    expect(parseIntakeBody("", "")).toEqual({});
    expect(parseIntakeBody("[1,2]", "application/json")).toBeNull();
    expect(parseIntakeBody("{roto", "application/json")).toBeNull();
  });

  it("finds every key a submission carries, cleaned of quotes, spaces and «Bearer»", () => {
    const of = (headers: Record<string, string>, body: Record<string, unknown>, url = "http://x/r") =>
      intakeKeyOf({ headers: new Headers(headers), body, url }).keys.map((k) => [k.from, k.key]);
    expect(of({ "x-salesmate-key": ' "a" ' }, {})).toEqual([["cabecera x-salesmate-key", "a"]]);
    expect(of({ "x-api-key": "Bearer b" }, {})).toEqual([["cabecera x-api-key", "b"]]);
    expect(of({ authorization: "Bearer c" }, {})).toEqual([["cabecera Authorization", "c"]]);
    expect(of({ authorization: "d" }, {})).toEqual([["cabecera Authorization", "d"]]);
    expect(of({ authorization: `Basic ${Buffer.from("e:f").toString("base64")}` }, {})).toEqual([
      ["Authorization: Basic (usuario)", "e"],
      ["Authorization: Basic (contraseña)", "f"],
    ]);
    expect(
      intakeKeyOf({ headers: new Headers(), body: { _key: "g", api_key: "h" }, url: "http://x/r" }),
    ).toEqual({
      keys: [
        { from: "campo _key", key: "g" },
        { from: "campo api_key", key: "h" },
      ],
      fields: ["_key", "api_key"],
    });
    expect(of({}, {}, "http://x/r?token=i")).toEqual([["?token= de la dirección", "i"]]);
    // Its own token in Authorization and the table's key elsewhere: both are tried.
    expect(of({ authorization: "Bearer tool-token", "x-salesmate-key": "j" }, {})).toEqual([
      ["cabecera x-salesmate-key", "j"],
      ["cabecera Authorization", "tool-token"],
    ]);
    expect(of({}, {})).toEqual([]);
  });
});
