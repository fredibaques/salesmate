import { describe, expect, it } from "vitest";
import { crumbsFor, type NameLookup } from "./crumbs";

const names: NameLookup = {
  project: async () => "Swipoo",
  source: async () => "Tarifas 2026.xlsx",
  conversation: async () => "Ana García",
  base: async () => "Concesionarios",
};
const labels = async (path: string) => (await crumbsFor(path.split("/"), names)).map((c) => c.label);

describe("crumbsFor", () => {
  it("places settings pages under their section", async () => {
    // A settings page has the section's header and tabs: no trail.
    expect(await labels("connections")).toEqual([]);
    expect(await labels("connections/new/google")).toEqual([
      "Configuración",
      "Conexiones",
      "Nueva conexión",
      "Google Workspace",
    ]);
    expect(await labels("ai/connect")).toEqual(["Configuración", "IA", "Conectar"]);
    // Top-level pages: their title is enough, no trail.
    expect(await labels("inbox")).toEqual([]);
    expect(await labels("copilot")).toEqual([]);
    expect(await labels("account/security")).toEqual([]);
  });

  it("starts project pages with the project's name and names what is open", async () => {
    // The project and its tabs have the project's header: the trail starts one level deeper.
    expect(await labels("projects/p1")).toEqual([]);
    expect(await labels("projects/p1/prospects")).toEqual([]);
    expect(await labels("projects/p1/rules")).toEqual([]);
    expect(await labels("projects/p1/agents/inbound")).toEqual(["Swipoo", "Agente inbound"]);
    expect(await labels("projects/p1/agents/inbound/channels")).toEqual([
      "Swipoo",
      "Agente inbound",
      "Canales y herramientas",
    ]);
    expect(await labels("projects/p1/agents/new/outbound")).toEqual(["Swipoo", "Añadir el agente outbound"]);
    expect(await labels("projects/p1/prospects/b1")).toEqual(["Swipoo", "Prospectos", "Concesionarios"]);
    expect(await labels("projects/p1/prospects/new")).toEqual(["Swipoo", "Prospectos", "Nueva base"]);
    expect(await labels("projects/p1/knowledge/s1")).toEqual(["Swipoo", "Conocimiento", "Tarifas 2026.xlsx"]);
    expect(await labels("projects/p1/conversations/c1")).toEqual(["Swipoo", "Conversaciones", "Ana García"]);
    expect(await labels("projects/new")).toEqual(["Panel", "Nuevo proyecto"]);
  });

  it("links every crumb but the current page", async () => {
    const crumbs = await crumbsFor(["projects", "p1", "knowledge", "s1"], names);
    expect(crumbs.map((c) => c.href)).toEqual(["/app/projects/p1", "/app/projects/p1/knowledge", undefined]);
  });
});
