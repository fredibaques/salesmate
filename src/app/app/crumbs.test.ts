import { describe, expect, it } from "vitest";
import { crumbsFor, type NameLookup } from "./crumbs";

const names: NameLookup = {
  project: async () => "Swipoo",
  source: async () => "Tarifas 2026.xlsx",
  conversation: async () => "Ana García",
  base: async () => "Concesionarios",
  meeting: async () => "Demo con Ana",
  agent: async (_, type) => (type === "inbound" ? "Recepción web" : null),
};
const labels = async (path: string) => (await crumbsFor(path.split("/"), names)).map((c) => c.label);

describe("crumbsFor", () => {
  it("places settings pages under their section", async () => {
    // A settings page has the section's header and tabs: no trail.
    expect(await labels("connections")).toEqual([]);
    expect(await labels("ai/connect")).toEqual(["Configuración", "IA", "Conectar"]);
    // Top-level pages: their title is enough, no trail.
    expect(await labels("inbox")).toEqual([]);
    expect(await labels("copilot")).toEqual([]);
    expect(await labels("account/security")).toEqual([]);
    expect(await labels("knowledge")).toEqual([]);
    expect(await labels("knowledge/s1")).toEqual(["Conocimiento", "Tarifas 2026.xlsx"]);
  });

  it("starts project pages with the project's name and names what is open", async () => {
    // The project and its tabs have the project's header: the trail starts one level deeper.
    expect(await labels("projects/p1")).toEqual([]);
    expect(await labels("projects/p1/prospects")).toEqual([]);
    expect(await labels("projects/p1/rules")).toEqual([]);
    expect(await labels("projects/p1/agents/outbound")).toEqual(["Swipoo", "Agente outbound"]);
    // An agent the user renamed shows its own name.
    expect(await labels("projects/p1/agents/inbound/channels")).toEqual([
      "Swipoo",
      "Recepción web",
      "Canales y herramientas",
    ]);
    expect(await labels("projects/p1/agents/new/outbound")).toEqual(["Swipoo", "Añadir el agente outbound"]);
    expect(await labels("projects/p1/prospects/b1")).toEqual(["Swipoo", "Tablas", "Concesionarios"]);
    expect(await labels("projects/p1/prospects/new")).toEqual(["Swipoo", "Tablas", "Nueva tabla"]);
    expect(await labels("projects/p1/knowledge/s1")).toEqual(["Swipoo", "Conocimiento", "Tarifas 2026.xlsx"]);
    expect(await labels("projects/p1/conversations/c1")).toEqual(["Swipoo", "Conversaciones", "Ana García"]);
    expect(await labels("projects/p1/meetings/m1")).toEqual(["Swipoo", "Reuniones", "Demo con Ana"]);
    expect(await labels("tables/b1")).toEqual(["Tablas", "Concesionarios"]);
    expect(await labels("tables")).toEqual([]);
    expect(await labels("projects/new")).toEqual(["Panel", "Nuevo proyecto"]);
  });

  it("links every crumb but the current page", async () => {
    const crumbs = await crumbsFor(["projects", "p1", "knowledge", "s1"], names);
    expect(crumbs.map((c) => c.href)).toEqual(["/app/projects/p1", "/app/projects/p1/knowledge", undefined]);
  });
});
