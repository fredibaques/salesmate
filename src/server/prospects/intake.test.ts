import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import type { TenantContext } from "../db/tenant";
import { createBase } from "./bases";
import { intakeRow, setIntakeKey } from "./intake";
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
});
