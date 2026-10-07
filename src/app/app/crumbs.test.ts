import { describe, expect, it } from "vitest";
import { crumbsFor, type NameLookup } from "./crumbs";

const names: NameLookup = {
  project: async () => "Swipoo",
  source: async () => "Tarifas 2026.xlsx",
  conversation: async () => "Ana García",
};
const labels = async (path: string) => (await crumbsFor(path.split("/"), names)).map((c) => c.label);

describe("crumbsFor", () => {
  it("places settings pages under their section", async () => {
    expect(await labels("connections")).toEqual(["Configuración", "Conexiones"]);
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
    expect(await labels("account/security")).toEqual(["Mi cuenta", "Seguridad"]);
  });

  it("starts project pages with the project's name and names what is open", async () => {
    expect(await labels("projects/p1")).toEqual(["Swipoo", "Agentes"]);
    expect(await labels("projects/p1/agents/inbound/channels")).toEqual([
      "Swipoo",
      "Agentes",
      "Agente inbound",
      "Canales y herramientas",
    ]);
    expect(await labels("projects/p1/agents/new/outbound")).toEqual([
      "Swipoo",
      "Agentes",
      "Añadir el agente outbound",
    ]);
    expect(await labels("projects/p1/knowledge/s1")).toEqual(["Swipoo", "Conocimiento", "Tarifas 2026.xlsx"]);
    expect(await labels("projects/p1/conversations/c1")).toEqual(["Swipoo", "Conversaciones", "Ana García"]);
    expect(await labels("projects/p1/rules")).toEqual(["Swipoo", "Ajustes", "Reglas y exclusiones"]);
    expect(await labels("projects/new")).toEqual(["Panel", "Nuevo proyecto"]);
  });

  it("links every crumb but the current page", async () => {
    const crumbs = await crumbsFor(["projects", "p1", "knowledge", "s1"], names);
    expect(crumbs.map((c) => c.href)).toEqual(["/app/projects/p1", "/app/projects/p1/knowledge", undefined]);
  });
});
