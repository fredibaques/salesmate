import { and, asc, count, eq, inArray, isNotNull, isNull, max, ne, or, sql, type SQL } from "drizzle-orm";
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
  type RowKind,
  type SystemField,
} from "@/lib/prospect-columns";
import { audit } from "../audit";
import type { Db } from "../db/client";
import {
  agentConfigs,
  projects,
  prospectBaseProjects,
  prospectBases,
  prospectLinkSearches,
  prospects,
} from "../db/schema";
import { workingSql } from "../agents/working";
import { withTenant, type TenantContext, type Tx } from "../db/tenant";
import { foldText } from "../knowledge/normalize";

/**
 * Tables («bases»): the user decides their columns; agents, people and
 * external forms fill them; people review and export them. A table may
 * belong to one project, be shared with some projects, or be the whole
 * account's (every project uses it). An agent works on the tables its
 * project uses.
 */

export type ProspectBase = typeof prospectBases.$inferSelect & {
  /** The projects it is shared with, when it isn't one project's (none = every project). */
  projectIds: string[];
};

/**
 * The tables a project uses: its own, those shared with it and those of the
 * whole account (no project and shared with none in particular).
 */
export function basesOfProject(projectId: string): SQL {
  const shared = (more: SQL = sql`true`) =>
    sql`exists (select 1 from ${prospectBaseProjects} where ${prospectBaseProjects.baseId} = ${prospectBases.id} and ${more})`;
  return or(
    eq(prospectBases.projectId, projectId),
    and(
      isNull(prospectBases.projectId),
      or(sql`not ${shared()}`, shared(sql`${prospectBaseProjects.projectId} = ${projectId}`)),
    ),
  )!;
}

/** The projects each of these tables is shared with, by table. */
async function sharedProjects(tx: Tx, baseIds: string[]): Promise<Map<string, string[]>> {
  const rows = baseIds.length
    ? await tx
        .select({ baseId: prospectBaseProjects.baseId, projectId: prospectBaseProjects.projectId })
        .from(prospectBaseProjects)
        .where(inArray(prospectBaseProjects.baseId, baseIds))
    : [];
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.baseId, [...(out.get(r.baseId) ?? []), r.projectId]);
  return out;
}

export async function getBase(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  baseId: string,
): Promise<ProspectBase | null> {
  return withTenant(db, tenant, async (tx) => {
    const [row] = await tx.select().from(prospectBases).where(eq(prospectBases.id, baseId));
    if (!row) return null;
    return { ...row, projectIds: (await sharedProjects(tx, [row.id])).get(row.id) ?? [] };
  });
}

/** How the agents that fill a base are called. */
function agentNames(agents: { agentType: string; name: string | null }[]): string[] {
  return agents.map((a) =>
    a.agentType in AGENT_INFO ? agentName(a.agentType as ProjectAgentKey, a.name) : a.agentType,
  );
}

/**
 * The tables an agent of the project may work on, with their row counts and
 * the agents that fill them: the project's own and, with `shared`, those
 * shared with it and the whole account's.
 */
export async function listBases(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectId: string,
  options: { shared?: boolean } = {},
) {
  return withTenant(db, tenant, async (tx) => {
    const bases = await tx
      .select()
      .from(prospectBases)
      .where(options.shared ? basesOfProject(projectId) : eq(prospectBases.projectId, projectId))
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
 * Every table of the organization (or those one project uses), most recently
 * active first: the «Tablas» section, a project's tab and the sidebar.
 * Activity is the last row added or changed, or the last change to the table
 * itself. `projectName` says whose it is: a project, the projects it is
 * shared with, or the whole account (null).
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
      .where(filter.projectId ? basesOfProject(filter.projectId) : undefined);
    const shared = await sharedProjects(
      tx,
      bases.map((b) => b.base.id),
    );
    const names = new Map(
      (await tx.select({ id: projects.id, name: projects.name }).from(projects)).map((p) => [p.id, p.name]),
    );
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
        const projectIds = shared.get(base.id) ?? [];
        return {
          ...base,
          projectIds,
          projectName:
            projectName ??
            (projectIds.length
              ? projectIds
                  .map((id) => names.get(id))
                  .filter(Boolean)
                  .join(", ")
              : null),
          rows: Number(stat?.n ?? 0),
          agents: agents.filter((a) => a.baseId === base.id).map((a) => a.agentType),
          agentNames: agentNames(agents.filter((a) => a.baseId === base.id)),
          lastActivity: last && last > base.updatedAt ? last : base.updatedAt,
        };
      })
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  });
}

/**
 * The tables each project uses, for the sidebar: its own, those shared with
 * it and the whole account's, by name.
 */
export async function tablesByProject(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  projectIds: string[],
): Promise<Map<string, { id: string; name: string; rowKind: RowKind }[]>> {
  return withTenant(db, tenant, async (tx) => {
    const bases = await tx
      .select({
        id: prospectBases.id,
        name: prospectBases.name,
        rowKind: prospectBases.rowKind,
        projectId: prospectBases.projectId,
      })
      .from(prospectBases)
      .orderBy(asc(prospectBases.name));
    const shared = await sharedProjects(
      tx,
      bases.filter((b) => !b.projectId).map((b) => b.id),
    );
    return new Map(
      projectIds.map((projectId) => [
        projectId,
        bases
          .filter((b) =>
            b.projectId
              ? b.projectId === projectId
              : !shared.get(b.id)?.length || shared.get(b.id)!.includes(projectId),
          )
          .map(({ id, name, rowKind }) => ({ id, name, rowKind })),
      ]),
    );
  });
}

/** Every table of the organization by name: what a relation column can point at. */
export async function listBaseNames(db: Db, tenant: Pick<TenantContext, "orgId">) {
  return withTenant(db, tenant, (tx) =>
    tx
      .select({ id: prospectBases.id, name: prospectBases.name, rowKind: prospectBases.rowKind })
      .from(prospectBases)
      .orderBy(asc(prospectBases.name)),
  );
}

/** The agents that fill a table (from any project), with how they are called. */
export async function baseAgents(db: Db, tenant: Pick<TenantContext, "orgId">, baseId: string) {
  const rows = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        id: agentConfigs.id,
        projectId: agentConfigs.projectId,
        projectName: projects.name,
        agentType: agentConfigs.agentType,
        name: agentConfigs.name,
        icon: agentConfigs.icon,
        color: agentConfigs.color,
        enabled: agentConfigs.enabled,
        settings: agentConfigs.settings,
        working: workingSql,
      })
      .from(agentConfigs)
      .innerJoin(projects, eq(projects.id, agentConfigs.projectId))
      .where(and(eq(agentConfigs.prospectBaseId, baseId), isNotNull(agentConfigs.addedAt))),
  );
  const labels = agentNames(rows);
  return rows.map((a, i) => ({ ...a, label: labels[i] }));
}

/** Moves a table to a project, or makes it the whole account's (null). */
export async function setBaseProject(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  projectId: string | null,
) {
  return setBaseProjects(db, tenant, baseId, projectId ? [projectId] : null);
}

/**
 * The projects that use a table: one (it becomes that project's), several
 * (shared with them), or null for every project of the account. Agents of
 * projects that no longer use it stop filling it.
 */
export async function setBaseProjects(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  projectIds: string[] | null,
) {
  const wanted = projectIds ? [...new Set(projectIds)] : null;
  if (wanted && wanted.length === 0) throw new Error("Elige al menos un proyecto.");
  return withTenant(db, tenant, async (tx) => {
    if (wanted) {
      const found = await tx.select({ id: projects.id }).from(projects).where(inArray(projects.id, wanted));
      if (found.length !== wanted.length) throw new Error("Proyecto no encontrado.");
    }
    const projectId = wanted?.length === 1 ? wanted[0] : null;
    const [base] = await tx
      .update(prospectBases)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(prospectBases.id, baseId))
      .returning();
    if (!base) throw new Error("Tabla no encontrada.");
    await tx.delete(prospectBaseProjects).where(eq(prospectBaseProjects.baseId, baseId));
    if (wanted && wanted.length > 1) {
      await tx
        .insert(prospectBaseProjects)
        .values(wanted.map((id) => ({ orgId: tenant.orgId, baseId, projectId: id })));
    }
    // Its rows follow it.
    await tx.update(prospects).set({ projectId }).where(eq(prospects.baseId, baseId));
    // Agents of the projects that don't use it any more stop filling it.
    if (wanted) {
      await tx
        .update(agentConfigs)
        .set({ prospectBaseId: null })
        .where(
          and(
            eq(agentConfigs.prospectBaseId, baseId),
            sql`${agentConfigs.projectId} not in (${sql.join(
              wanted.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          ),
        );
    }
    await audit(tx, tenant, {
      event: "prospect_base.moved",
      projectId,
      entityType: "prospect_base",
      entityId: base.id,
      data: { projectIds: wanted ?? "all" },
    });
    return { ...base, projectIds: wanted && wanted.length > 1 ? wanted : [] };
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
    if (base) return { ...base, projectIds: (await sharedProjects(tx, [base.id])).get(base.id) ?? [] };
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
  return { ...base, hiddenFields: [], projectIds: [] };
}

/**
 * An agent fills the web, the fit and the sources of each row: once one
 * works on a table, those fields show (people may hide them again).
 */
async function showAgentFields(tx: Tx, baseId: string) {
  await tx.update(prospectBases).set({ hiddenFields: [] }).where(eq(prospectBases.id, baseId));
}

/** Points an agent at a table its project uses; null = none. */
export async function setAgentBase(
  db: Db,
  tenant: TenantContext,
  projectId: string,
  agentConfigId: string,
  baseId: string | null,
) {
  return withTenant(db, tenant, async (tx) => {
    if (!baseId) {
      const [agent] = await tx
        .update(agentConfigs)
        .set({ prospectBaseId: null })
        .where(and(eq(agentConfigs.id, agentConfigId), eq(agentConfigs.projectId, projectId)))
        .returning({ id: agentConfigs.id, agentType: agentConfigs.agentType });
      if (!agent) throw new Error("Agente no encontrado.");
      await audit(tx, tenant, {
        event: "agent.base_changed",
        projectId,
        entityType: "agent_config",
        entityId: agent.id,
        data: { agentType: agent.agentType, base: null },
      });
      return;
    }
    const [base] = await tx
      .select({ id: prospectBases.id, name: prospectBases.name })
      .from(prospectBases)
      .where(and(eq(prospectBases.id, baseId), basesOfProject(projectId)));
    if (!base) throw new Error("Este proyecto no usa esa tabla.");
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
  assertOneStage(out);
  return out.slice(existing.length);
}

/**
 * The board view lists rows by one column, and a row belongs to one row of
 * another table: a table has one pipeline column and one relation at most.
 */
function assertOneStage(columns: BaseColumn[]) {
  if (columns.filter((c) => c.type === "stage").length > 1) {
    throw new Error("Esta tabla ya tiene una columna de fase del pipeline: solo puede tener una.");
  }
  if (columns.filter((c) => c.type === "link").length > 1) {
    throw new Error("Esta tabla ya tiene una relación con otra tabla: solo puede tener una.");
  }
}

/** A relation points at another table of the organization. */
async function assertLinkTarget(tx: Tx, baseId: string | null, column: BaseColumn) {
  if (column.type !== "link") return;
  if (column.linkBaseId === baseId) throw new Error("Una tabla no puede relacionarse consigo misma.");
  const [target] = await tx
    .select({ id: prospectBases.id })
    .from(prospectBases)
    .where(eq(prospectBases.id, column.linkBaseId ?? ""));
  if (!target) throw new Error("La tabla relacionada no existe.");
}

/** Rows no longer linked: the relation changed table, or went away. */
async function unlinkRows(tx: Tx, baseId: string) {
  await tx.update(prospects).set({ parentId: null }).where(eq(prospects.baseId, baseId));
  await tx.delete(prospectLinkSearches).where(eq(prospectLinkSearches.baseId, baseId));
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
    for (const column of columns) await assertLinkTarget(tx, null, column);
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
    return { ...base, projectIds: [] };
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
 * The rows of other tables that belong to rows of this one (people of its
 * companies), by table: deleting this table deletes them too.
 */
export async function linkedRowsOf(db: Db, tenant: Pick<TenantContext, "orgId">, baseId: string) {
  return withTenant(db, tenant, async (tx) => {
    const rows = await tx
      .select({ baseId: prospects.baseId, name: prospectBases.name, n: count() })
      .from(prospects)
      .innerJoin(prospectBases, eq(prospectBases.id, prospects.baseId))
      .where(
        and(
          ne(prospects.baseId, baseId),
          inArray(
            prospects.parentId,
            tx.select({ id: prospects.id }).from(prospects).where(eq(prospects.baseId, baseId)),
          ),
        ),
      )
      .groupBy(prospects.baseId, prospectBases.name);
    return rows.map((r) => ({ ...r, n: Number(r.n) }));
  });
}

/**
 * Deletes a base and its rows, and the rows of other tables that belong to
 * them (their relation goes away too). Agents that filled it go back to the
 * project's first base (or a new one) on their next run.
 */
export async function deleteBase(db: Db, tenant: TenantContext, baseId: string) {
  const linked = await linkedRowsOf(db, tenant, baseId);
  return withTenant(db, tenant, async (tx) => {
    const [rows] = await tx.select({ n: count() }).from(prospects).where(eq(prospects.baseId, baseId));
    const [base] = await tx.delete(prospectBases).where(eq(prospectBases.id, baseId)).returning();
    if (!base) throw new Error("Base de prospectos no encontrada.");
    // The tables that pointed at it lose their relation column.
    const pointing = await tx
      .select()
      .from(prospectBases)
      .where(sql`${prospectBases.columns} @> ${JSON.stringify([{ linkBaseId: baseId }])}::jsonb`);
    for (const other of pointing) {
      await tx
        .update(prospectBases)
        .set({ columns: other.columns.filter((c) => c.linkBaseId !== baseId), updatedAt: new Date() })
        .where(eq(prospectBases.id, other.id));
    }
    await audit(tx, tenant, {
      event: "prospect_base.deleted",
      projectId: base.projectId,
      entityType: "prospect_base",
      entityId: base.id,
      data: {
        name: base.name,
        rows: Number(rows.n),
        ...(linked.length ? { linked: linked.map((l) => `${l.name}: ${l.n}`) } : {}),
      },
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
  base: typeof prospectBases.$inferSelect,
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
 * cleared, and how many is returned. New instructions mean the cells the
 * agent didn't find are looked for again (`retried`).
 */
export async function saveColumn(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  draft: ColumnDraft,
  existingId?: string,
): Promise<{ column: BaseColumn; cleared: number; retried: number }> {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    if (!existingId) {
      const [column] = newColumns([draft], base.columns);
      await assertLinkTarget(tx, base.id, column);
      await writeColumns(tx, tenant, base, [...base.columns, column], "prospect_base.column_added", {
        column: column.name,
        type: column.type,
      });
      return { column, cleared: 0, retried: 0 };
    }
    const index = base.columns.findIndex((c) => c.id === existingId);
    if (index < 0) throw new Error("Esa columna ya no existe.");
    const parsed = columnDraft.safeParse(draft);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Columna no válida.");
    assertFreeName(base.columns, parsed.data.name, existingId);
    const before = base.columns[index];
    const column: BaseColumn = { ...before, ...parsed.data, id: before.id };
    const columns = base.columns.map((c, i) => (i === index ? column : c));
    assertOneStage(columns);
    await assertLinkTarget(tx, base.id, column);
    // Pointing at another table (or no longer being a relation) unlinks every row.
    if (before.type === "link" && (column.type !== "link" || column.linkBaseId !== before.linkBaseId)) {
      await unlinkRows(tx, base.id);
    }
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
    const retried =
      (before.instructions ?? "").trim() !== (column.instructions ?? "").trim()
        ? await clearNotFound(tx, base.id, column.id)
        : 0;
    await writeColumns(tx, tenant, base, columns, "prospect_base.column_changed", {
      column: column.name,
      type: column.type,
      cleared,
    });
    return { column, cleared, retried };
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

/** Narrowest and widest a column can be dragged to. */
export const COLUMN_WIDTH = { min: 60, max: 800 } as const;

/** Stores how wide a column (or fixed field) shows; everyone sees the table the same way. */
export async function setColumnWidth(
  db: Db,
  tenant: TenantContext,
  baseId: string,
  key: string,
  width: number,
) {
  const px = Math.round(Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, width)));
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const known =
      key === "id" ||
      base.columns.some((c) => c.id === key) ||
      systemFields(base.rowKind).includes(key as SystemField);
    if (!known) throw new Error("Esa columna no existe.");
    await tx
      .update(prospectBases)
      .set({ columnWidths: { ...base.columnWidths, [key]: px } })
      .where(eq(prospectBases.id, base.id));
    return px;
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

/** Forgets the «not found» marks of a column, so the next completion looks for them again. */
async function clearNotFound(tx: Tx, baseId: string, columnId: string): Promise<number> {
  const rows = await tx
    .update(prospects)
    .set({ cellMeta: sql`${prospects.cellMeta} - ${columnId}` })
    .where(
      and(
        eq(prospects.baseId, baseId),
        sql`not (${prospects.data} ? ${columnId})`,
        sql`coalesce((${prospects.cellMeta} -> ${columnId} ->> 'notFound')::boolean, false)`,
      ),
    )
    .returning({ id: prospects.id });
  return rows.length;
}

/** The cells of a column the agent didn't find, back to empty: «Volver a buscar». */
export async function retryNotFound(db: Db, tenant: TenantContext, baseId: string, columnId: string) {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const column = base.columns.find((c) => c.id === columnId);
    if (!column) throw new Error("Esa columna ya no existe.");
    const retried = await clearNotFound(tx, base.id, column.id);
    if (retried) {
      await audit(tx, tenant, {
        event: "prospect_base.not_found_retried",
        projectId: base.projectId,
        entityType: "prospect_base",
        entityId: base.id,
        data: { column: column.name, cells: retried },
      });
    }
    return retried;
  });
}

/** Deletes a column and the values it held. */
export async function removeColumn(db: Db, tenant: TenantContext, baseId: string, id: string) {
  return withTenant(db, tenant, async (tx) => {
    const base = await lockedBase(tx, baseId);
    const column = base.columns.find((c) => c.id === id);
    if (!column) throw new Error("Esa columna ya no existe.");
    if (column.type === "link") await unlinkRows(tx, base.id);
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
