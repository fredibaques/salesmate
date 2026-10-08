import { and, asc, count, eq, inArray, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AGENT_INFO, agentName, type ProjectAgentKey } from "@/lib/agents";
import {
  checkCell,
  columnDraft,
  columnId,
  DEFAULT_COMPANY_COLUMNS,
  MAX_COLUMNS,
  primaryField,
  ROW_KINDS,
  systemFields,
  type BaseColumn,
  type ColumnDraft,
  type SystemField,
} from "@/lib/prospect-columns";
import { audit } from "../audit";
import type { Db } from "../db/client";
import { agentConfigs, projects, prospectBases, prospects } from "../db/schema";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { foldText } from "../knowledge/normalize";

/**
 * Tables («bases»): the user decides their columns; agents, people and
 * external forms fill them; people review and export them. A table may
 * belong to a project or stand on its own. An agent works on a table of its
 * project or on one without a project.
 */

export type ProspectBase = typeof prospectBases.$inferSelect;

export async function getBase(db: Db, tenant: Pick<TenantContext, "orgId">, baseId: string) {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx.select().from(prospectBases).where(eq(prospectBases.id, baseId)),
  );
  return row ?? null;
}

/** How the agents that fill a base are called. */
function agentNames(agents: { agentType: string; name: string | null }[]): string[] {
  return agents.map((a) =>
    a.agentType in AGENT_INFO ? agentName(a.agentType as ProjectAgentKey, a.name) : a.agentType,
  );
}

/**
 * The tables an agent of the project may work on, with their row counts and
 * the agents that fill them: the project's own and, with `standalone`, those
 * without a project.
 */
export async function listBases(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  options: { standalone?: boolean } = {},
) {
  return withTenant(db, tenant, async (tx) => {
    const bases = await tx
      .select()
      .from(prospectBases)
      .where(
        options.standalone
          ? or(eq(prospectBases.projectId, projectId), isNull(prospectBases.projectId))
          : eq(prospectBases.projectId, projectId),
      )
      .orderBy(asc(prospectBases.createdAt));
    const counts = bases.length
      ? await tx
          .select({ baseId: prospects.baseId, n: count() })
          .from(prospects)
          .where(
            inArray(
              prospects.baseId,
              bases.map((b) => b.id),
            ),
          )
          .groupBy(prospects.baseId)
      : [];
    const agents = await tx
      .select({
        baseId: agentConfigs.prospectBaseId,
        agentType: agentConfigs.agentType,
        name: agentConfigs.name,
      })
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.projectId, projectId),
          isNotNull(agentConfigs.addedAt),
          isNotNull(agentConfigs.prospectBaseId),
        ),
      );
    return bases.map((b) => ({
      ...b,
      rows: Number(counts.find((c) => c.baseId === b.id)?.n ?? 0),
      agents: agents.filter((a) => a.baseId === b.id).map((a) => a.agentType),
      agentNames: agentNames(agents.filter((a) => a.baseId === b.id)),
    }));
  });
}

/**
 * Every table of the organization (or of one project), most recently active
 * first: the «Tablas» section and a project's tab. Activity is the last row
 * added or changed, or the last change to the table itself.
 */
export async function listAllBases(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  filter: { projectId?: string } = {},
) {
  return withTenant(db, tenant, async (tx) => {
    const bases = await tx
      .select({ base: prospectBases, projectName: projects.name })
      .from(prospectBases)
      .leftJoin(projects, eq(projects.id, prospectBases.projectId))
      .where(filter.projectId ? eq(prospectBases.projectId, filter.projectId) : undefined);
    const stats = await tx
      .select({ baseId: prospects.baseId, n: count(), last: max(prospects.updatedAt) })
      .from(prospects)
      .groupBy(prospects.baseId);
    const agents = await tx
      .select({
        baseId: agentConfigs.prospectBaseId,
        agentType: agentConfigs.agentType,
        name: agentConfigs.name,
      })
      .from(agentConfigs)
      .where(and(isNotNull(agentConfigs.addedAt), isNotNull(agentConfigs.prospectBaseId)));
    return bases
      .map(({ base, projectName }) => {
        const stat = stats.find((s) => s.baseId === base.id);
        const last = stat?.last ? new Date(stat.last) : null;
        return {
          ...base,
          projectName,
          rows: Number(stat?.n ?? 0),
          agents: agents.filter((a) => a.baseId === base.id).map((a) => a.agentType),
          agentNames: agentNames(agents.filter((a) => a.baseId === base.id)),
          lastActivity: last && last > base.updatedAt ? last : base.updatedAt,
        };
      })
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  });
}

/** The agents that fill a table (from any project), with how they are called. */
export async function baseAgents(db: Db, tenant: Pick<TenantContext, "orgId">, baseId: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        projectId: agentConfigs.projectId,
        agentType: agentConfigs.agentType,
        name: agentConfigs.name,
      })
      .from(agentConfigs)
      .where(and(eq(agentConfigs.prospectBaseId, baseId), isNotNull(agentConfigs.addedAt))),
  );
  const labels = agentNames(rows);
  return rows.map((a, i) => ({ ...a, label: labels[i] }));
}

/** Moves a table to a project, or leaves it on its own (null). */
export async function setBaseProject(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  projectId: string | null,
) {
  return withTenant(db, tenant, async (tx) => {
    if (projectId) {
      const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId));
      if (!project) throw new Error("Proyecto no encontrado.");
    }
    const [base] = await tx
      .update(prospectBases)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(prospectBases.id, baseId))
      .returning();
    if (!base) throw new Error("Tabla no encontrada.");
    // Its rows follow it.
    await tx.update(prospects).set({ projectId }).where(eq(prospects.baseId, baseId));
    await audit(tx, tenant, {
      event: "prospect_base.moved",
      projectId,
      entityType: "prospect_base",
      entityId: base.id,
      data: { projectId },
    });
    return base;
  });
}

async function createDefaultBase(tx: Tx, tenant: TenantContext, projectId: string) {
  const [base] = await tx
    .insert(prospectBases)
    .values({
      orgId: tenant.orgId,
      projectId,
      name: "Prospectos",
      rowKind: "company",
      columns: DEFAULT_COMPANY_COLUMNS,
      createdBy: tenant.actorType === "user" ? tenant.actorId : null,
    })
    .returning();
  await audit(tx, tenant, {
    event: "prospect_base.created",
    projectId,
    entityType: "prospect_base",
    entityId: base.id,
    data: { name: base.name },
  });
  return base;
}

/**
 * The base an agent fills. An agent without one gets the project's first
 * base, or a new «Prospectos» base when the project has none.
 */
export async function ensureAgentBase(
  db: Db,
  tenant: TenantContext,
  agentConfigId: string,
): Promise<ProspectBase> {
  return withTenant(db, tenant, (tx) => ensureAgentBaseIn(tx, tenant, agentConfigId));
}

/** ensureAgentBase inside a transaction already open (adding an agent). */
export async function ensureAgentBaseIn(
  tx: Tx,
  tenant: TenantContext,
  agentConfigId: string,
): Promise<ProspectBase> {
  const [agent] = await tx.select().from(agentConfigs).where(eq(agentConfigs.id, agentConfigId));
  if (!agent) throw new Error("Agente no encontrado.");
  if (agent.prospectBaseId) {
    const [base] = await tx.select().from(prospectBases).where(eq(prospectBases.id, agent.prospectBaseId));
    if (base) return base;
  }
  const [first] = await tx
    .select()
    .from(prospectBases)
    .where(eq(prospectBases.projectId, agent.projectId))
    .orderBy(asc(prospectBases.createdAt))
    .limit(1);
  const base = first ?? (await createDefaultBase(tx, tenant, agent.projectId));
  await tx.update(agentConfigs).set({ prospectBaseId: base.id }).where(eq(agentConfigs.id, agent.id));
  await showAgentFields(tx, base.id);
  return { ...base, hiddenFields: [] };
}

/**
 * An agent fills the web, the fit and the sources of each row: once one
 * works on a table, those fields show (people may hide them again).
 */
async function showAgentFields(tx: Tx, baseId: string) {
  await tx.update(prospectBases).set({ hiddenFields: [] }).where(eq(prospectBases.id, baseId));
}

/** Points an agent at a table of its project, or at one without a project. */
export async function setAgentBase(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentConfigId: string,
  baseId: string,
) {
  return withTenant(db, tenant, async (tx) => {
    const [base] = await tx
      .select({ id: prospectBases.id, name: prospectBases.name })
      .from(prospectBases)
      .where(
        and(
          eq(prospectBases.id, baseId),
          or(eq(prospectBases.projectId, projectId), isNull(prospectBases.projectId)),
        ),
      );
    if (!base) throw new Error("Esa tabla es de otro proyecto.");
    const [agent] = await tx
      .update(agentConfigs)
      .set({ prospectBaseId: base.id })
      .where(and(eq(agentConfigs.id, agentConfigId), eq(agentConfigs.projectId, projectId)))
      .returning({ id: agentConfigs.id, agentType: agentConfigs.agentType });
    if (!agent) throw new Error("Agente no encontrado.");
    await showAgentFields(tx, base.id);
    await audit(tx, tenant, {
      event: "agent.base_changed",
      projectId,
      entityType: "agent_config",
      entityId: agent.id,
      data: { agentType: agent.agentType, base: base.name },
    });
  });
}

const baseName = z.string().trim().min(1, "Ponle un nombre a la base.").max(120);

/** Turns drafts into columns with ids, checking names and the column limit. */
function newColumns(drafts: ColumnDraft[], existing: BaseColumn[] = []): BaseColumn[] {
  const out = [...existing];
  for (const draft of drafts) {
    const parsed = columnDraft.safeParse(draft);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Columna no válida.");
    assertFreeName(out, parsed.data.name);
    out.push({
      id: columnId(
        parsed.data.name,
        out.map((c) => c.id),
      ),
      ...parsed.data,
    });
  }
  if (out.length > MAX_COLUMNS) throw new Error(`Una base admite hasta ${MAX_COLUMNS} columnas.`);
  return out.slice(existing.length);
}

function assertFreeName(columns: BaseColumn[], name: string, except?: string) {
  const folded = foldText(name).trim();
  if (columns.some((c) => c.id !== except && foldText(c.name).trim() === folded)) {
    throw new Error(`Ya hay una columna «${name}» en esta base.`);
  }
}

/** A new table, of a project or on its own (`projectId` null), with its first columns. */
export async function createBase(
  db: Db,
  tenant: TenantContext,
  projectId: string | null,
  input: { name: string; rowKind: string; columns: ColumnDraft[]; hiddenFields?: SystemField[] },
): Promise<ProspectBase> {
  const name = baseName.parse(input.name);
  const rowKind = z.enum(ROW_KINDS).parse(input.rowKind);
  const columns = newColumns(input.columns);
  const hiddenFields = (input.hiddenFields ?? []).filter(
    (f) => systemFields(rowKind).includes(f) && f !== primaryField(rowKind),
  );
  return withTenant(db, tenant, async (tx) => {
    const [base] = await tx
      .insert(prospectBases)
      .values({
        orgId: tenant.orgId,
        projectId,
        name,
        rowKind,
        columns,
        hiddenFields,
        createdBy: tenant.actorType === "user" ? tenant.actorId : null,
      })
      .returning();
    await audit(tx, tenant, {
      event: "prospect_base.created",
      projectId,
      entityType: "prospect_base",
      entityId: base.id,
      data: { name, rowKind, columns: columns.length },
    });
    return base;
  });
}

export async function renameBase(db: Db, tenant: TenantContext, baseId: string, name: string) {
  const clean = baseName.parse(name);
  return withTenant(db, tenant, async (tx) => {
    const [base] = await tx
      .update(prospectBases)
      .set({ name: clean, updatedAt: new Date() })
      .where(eq(prospectBases.id, baseId))
      .returning();
    if (!base) throw new Error("Base de prospectos no encontrada.");
    await audit(tx, tenant, {
      event: "prospect_base.renamed",
      projectId: base.projectId,
      entityType: "prospect_base",
      entityId: base.id,
      data: { name: clean },
    });
    return base;
  });
}

/**
 * Deletes a base and its rows. Agents that filled it go back to the
 * project's first base (or a new one) on their next run.
 */
export async function deleteBase(db: Db, tenant: TenantContext, baseId: string) {
  return withTenant(db, tenant, async (tx) => {
    const [rows] = await tx.select({ n: count() }).from(prospects).where(eq(prospects.baseId, baseId));
    const [base] = await tx.delete(prospectBases).where(eq(prospectBases.id, baseId)).returning();
    if (!base) throw new Error("Base de prospectos no encontrada.");
    await audit(tx, tenant, {
      event: "prospect_base.deleted",
      projectId: base.projectId,
      entityType: "prospect_base",
      entityId: base.id,
      data: { name: base.name, rows: Number(rows.n) },
    });
    return base;
  });
}

/** Reads a base's columns for a change, locking the row until the transaction ends. */
async function lockedBase(tx: Tx, baseId: string) {
  const [base] = await tx.select().from(prospectBases).where(eq(prospectBases.id, baseId)).for("update");
  if (!base) throw new Error("Base de prospectos no encontrada.");
  return base;
}

async function writeColumns(
  tx: Tx,
  tenant: TenantContext,
  base: ProspectBase,
  columns: BaseColumn[],
  event: string,
  data: Record<string, unknown>,
) {
  await tx.update(prospectBases).set({ columns, updatedAt: new Date() }).where(eq(prospectBases.id, base.id));
  await audit(tx, tenant, {
    event,
    projectId: base.projectId,
    entityType: "prospect_base",
    entityId: base.id,
    data,
  });
}

/**
 * Adds a column, or changes one (`columnId`). Changing its type or options
 * re-checks the values it already holds: the ones that no longer fit are
 * cleared, and how many is returned.
 */
export async function saveColumn(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  draft: ColumnDraft,
  existingId?: string,
): Promise<{ column: BaseColumn; cleared: number }> {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    if (!existingId) {
      const [column] = newColumns([draft], base.columns);
      await writeColumns(tx, tenant, base, [...base.columns, column], "prospect_base.column_added", {
        column: column.name,
        type: column.type,
      });
      return { column, cleared: 0 };
    }
    const index = base.columns.findIndex((c) => c.id === existingId);
    if (index < 0) throw new Error("Esa columna ya no existe.");
    const parsed = columnDraft.safeParse(draft);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Columna no válida.");
    assertFreeName(base.columns, parsed.data.name, existingId);
    const before = base.columns[index];
    const column: BaseColumn = { ...before, ...parsed.data, id: before.id };
    const columns = base.columns.map((c, i) => (i === index ? column : c));
    const reshaped =
      before.type !== column.type ||
      JSON.stringify(before.options ?? []) !== JSON.stringify(column.options ?? []);
    let cleared = 0;
    if (reshaped) {
      const rows = await tx
        .select({ id: prospects.id, data: prospects.data })
        .from(prospects)
        .where(and(eq(prospects.baseId, base.id), sql`${prospects.data} ? ${column.id}`));
      for (const row of rows) {
        const checked = checkCell(column, row.data[column.id]);
        const value = checked.ok ? checked.value : null;
        if (JSON.stringify(value) === JSON.stringify(row.data[column.id])) continue;
        if (value === null) cleared++;
        await tx
          .update(prospects)
          .set(
            value === null
              ? {
                  data: sql`${prospects.data} - ${column.id}`,
                  cellMeta: sql`${prospects.cellMeta} - ${column.id}`,
                }
              : { data: sql`${prospects.data} || ${JSON.stringify({ [column.id]: value })}::jsonb` },
          )
          .where(eq(prospects.id, row.id));
      }
    }
    await writeColumns(tx, tenant, base, columns, "prospect_base.column_changed", {
      column: column.name,
      type: column.type,
      cleared,
    });
    return { column, cleared };
  });
}

/** Moves a column one place left (-1) or right (1). */
export async function moveColumn(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  id: string,
  direction: -1 | 1,
) {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const index = base.columns.findIndex((c) => c.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= base.columns.length) return;
    const columns = [...base.columns];
    [columns[index], columns[target]] = [columns[target], columns[index]];
    await tx
      .update(prospectBases)
      .set({ columns, updatedAt: new Date() })
      .where(eq(prospectBases.id, base.id));
  });
}

/**
 * Drops a column next to another one (dragging its header): before it, or
 * after it.
 */
export async function placeColumn(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  id: string,
  target: { id: string; side: "before" | "after" },
) {
  if (id === target.id) return;
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const column = base.columns.find((c) => c.id === id);
    if (!column) throw new Error("Esa columna ya no existe.");
    const rest = base.columns.filter((c) => c.id !== id);
    const at = rest.findIndex((c) => c.id === target.id);
    if (at < 0) throw new Error("Esa columna ya no existe.");
    rest.splice(target.side === "before" ? at : at + 1, 0, column);
    await tx
      .update(prospectBases)
      .set({ columns: rest, updatedAt: new Date() })
      .where(eq(prospectBases.id, base.id));
  });
}

/** Shows or hides one of the fixed fields (web, fit…); the row's name always shows. */
export async function setFieldHidden(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  field: SystemField,
  hidden: boolean,
) {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    if (!systemFields(base.rowKind).includes(field)) throw new Error("Ese campo no existe.");
    if (field === primaryField(base.rowKind)) throw new Error("El nombre de cada fila no se puede ocultar.");
    const rest = base.hiddenFields.filter((f) => f !== field);
    await tx
      .update(prospectBases)
      .set({ hiddenFields: hidden ? [...rest, field] : rest, updatedAt: new Date() })
      .where(eq(prospectBases.id, base.id));
  });
}

/** Shows or hides a column in the table (its values stay). */
export async function setColumnHidden(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  id: string,
  hidden: boolean,
) {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const columns = base.columns.map((c) => (c.id === id ? { ...c, hidden: hidden || undefined } : c));
    await tx
      .update(prospectBases)
      .set({ columns, updatedAt: new Date() })
      .where(eq(prospectBases.id, base.id));
  });
}

/** Deletes a column and the values it held. */
export async function removeColumn(db: Db, tenant: TenantContext, baseId: string, id: string) {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const column = base.columns.find((c) => c.id === id);
    if (!column) throw new Error("Esa columna ya no existe.");
    await tx
      .update(prospects)
      .set({ data: sql`${prospects.data} - ${id}`, cellMeta: sql`${prospects.cellMeta} - ${id}` })
      .where(
        and(
          eq(prospects.baseId, base.id),
          or(sql`${prospects.data} ? ${id}`, sql`${prospects.cellMeta} ? ${id}`),
        ),
      );
    await writeColumns(
      tx,
      tenant,
      base,
      base.columns.filter((c) => c.id !== id),
      "prospect_base.column_removed",
      { column: column.name },
    );
  });
}
