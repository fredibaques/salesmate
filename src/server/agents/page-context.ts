import { and, desc, eq } from "drizzle-orm";
import { agentName } from "@/lib/agents";
import { describeSchedule } from "@/lib/schedule";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, projects, prospectBases, prospects } from "../db/schema";
import { withTenant } from "../db/tenant";
import { isProjectAgentType } from "../services/agents";

/**
 * What the person is looking at when they ask the Copilot from the top bar:
 * a table (its columns and a sample of rows), an agent (how it is set up and
 * how its last runs went) or a project. The Copilot gets it as context, so
 * «resume esta tabla» or «¿por qué este agente no encuentra…?» make sense.
 */
export type PageContext = {
  /** Shown in the panel: «Tabla «Prospectos»». */
  label: string;
  /** The project to answer from, when the page belongs to one. */
  projectId: string | null;
  /** For the model, in Spanish. */
  text: string;
};

const SAMPLE_ROWS = 30;
const SCAN_ROWS = 500;
const cut = (value: unknown, max = 80) => {
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export async function pageContext(
  db: Db,
  tenant: { orgId: string },
  pathname: string,
  /** Whether the person may open a project (members may see only some). */
  canSee: (projectId: string | null) => boolean,
): Promise<PageContext | null> {
  const segments = pathname.split("?")[0].split("/").filter(Boolean);
  if (segments[0] !== "app") return null;
  const [section, id, sub, subId] = segments.slice(1);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

  if (section === "tables" && uuid(id)) return tableContext(db, tenant, id, canSee);
  if (section === "projects" && uuid(id) && canSee(id)) {
    if (sub === "agents" && uuid(subId)) return agentContext(db, tenant, id, subId);
    const [project] = await withTenant(db, tenant, (tx) =>
      tx.select({ name: projects.name }).from(projects).where(eq(projects.id, id)),
    );
    return project
      ? { label: `Proyecto «${project.name}»`, projectId: id, text: "Está viendo el resumen del proyecto." }
      : null;
  }
  return null;
}

async function tableContext(
  db: Db,
  tenant: { orgId: string },
  baseId: string,
  canSee: (projectId: string | null) => boolean,
): Promise<PageContext | null> {
  const found = await withTenant(db, tenant, async (tx) => {
    const [base] = await tx.select().from(prospectBases).where(eq(prospectBases.id, baseId));
    if (!base) return null;
    const rows = await tx
      .select({
        seq: prospects.seq,
        company: prospects.companyName,
        person: prospects.personName,
        website: prospects.website,
        status: prospects.status,
        data: prospects.data,
        meta: prospects.cellMeta,
      })
      .from(prospects)
      .where(eq(prospects.baseId, baseId))
      .orderBy(prospects.seq)
      .limit(SCAN_ROWS);
    return { base, rows };
  });
  if (!found || !canSee(found.base.projectId)) return null;
  const { base, rows } = found;
  const columns = base.columns.filter((c) => !c.hidden);
  const filled = (v: unknown) =>
    v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length);
  const columnLines = columns.map((c) => {
    const have = rows.filter((r) => filled(r.data[c.id])).length;
    const notFound = rows.filter((r) => !filled(r.data[c.id]) && r.meta[c.id]?.notFound).length;
    return `- ${c.name} (${c.type}${c.filledBy === "agent" ? ", la rellena el agente" : ""}): ${have} de ${rows.length} con valor${notFound ? `, ${notFound} marcadas «no encontrado»` : ""}${c.instructions ? `. Instrucciones: ${cut(c.instructions, 300)}` : ""}`;
  });
  const sample = rows.slice(0, SAMPLE_ROWS).map((r) => {
    const name = r.person ? `${r.person} (${r.company})` : r.company;
    const cells = columns.filter((c) => filled(r.data[c.id])).map((c) => `${c.name}: ${cut(r.data[c.id])}`);
    return `- #${r.seq} ${name}${r.website ? ` · ${r.website}` : ""} · ${r.status}${cells.length ? ` · ${cells.join(" · ")}` : ""}`;
  });
  return {
    label: `Tabla «${base.name}»`,
    projectId: base.projectId,
    text: [
      `Está viendo la tabla «${base.name}»${rows.length >= SCAN_ROWS ? ` (se han leído sus primeras ${SCAN_ROWS} filas)` : ` (${rows.length} filas)`}.`,
      columnLines.length ? `Columnas:\n${columnLines.join("\n")}` : "No tiene columnas propias.",
      sample.length
        ? `Primeras filas${rows.length > SAMPLE_ROWS ? ` (${SAMPLE_ROWS} de ${rows.length})` : ""}:\n${sample.join("\n")}`
        : "Todavía no tiene filas.",
    ].join("\n\n"),
  };
}

async function agentContext(
  db: Db,
  tenant: { orgId: string },
  projectId: string,
  agentId: string,
): Promise<PageContext | null> {
  const found = await withTenant(db, tenant, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.id, agentId), eq(agentConfigs.projectId, projectId)));
    if (!agent?.addedAt) return null;
    const [base] = agent.prospectBaseId
      ? await tx
          .select({ name: prospectBases.name })
          .from(prospectBases)
          .where(eq(prospectBases.id, agent.prospectBaseId))
      : [];
    const runs = await tx
      .select({
        startedAt: agentRuns.startedAt,
        status: agentRuns.status,
        summary: agentRuns.summary,
        error: agentRuns.error,
        notice: agentRuns.notice,
        costUsd: agentRuns.costUsd,
      })
      .from(agentRuns)
      .where(eq(agentRuns.agentConfigId, agentId))
      .orderBy(desc(agentRuns.startedAt))
      .limit(5);
    return { agent, base, runs };
  });
  if (!found) return null;
  const { agent, base, runs } = found;
  const type = agent.agentType;
  if (!isProjectAgentType(type)) return null;
  const name = agentName(type, agent.name);
  const runLines = runs.map(
    (r) =>
      `- ${r.startedAt.toISOString().slice(0, 16).replace("T", " ")} · ${r.status}${r.notice ? ` · ${r.notice.headline}` : ""} · ${r.costUsd.toFixed(2)} $${r.summary ? `\n  Resumen: ${cut(r.summary, 500)}` : ""}${r.error ? `\n  Error: ${cut(r.error, 300)}` : ""}`,
  );
  return {
    label: `Agente «${name}»`,
    projectId,
    text: [
      `Está viendo el agente «${name}» (${type}), ${agent.enabled ? "activo" : "en pausa"}. Horario: ${describeSchedule(agent.schedule)}.${base ? ` Trabaja en la tabla «${base.name}».` : ""}`,
      agent.instructions
        ? `Sus instrucciones:\n${cut(agent.instructions, 1500)}`
        : "No tiene instrucciones propias.",
      runLines.length ? `Sus últimas ejecuciones:\n${runLines.join("\n")}` : "Todavía no ha trabajado.",
    ].join("\n\n"),
  };
}
