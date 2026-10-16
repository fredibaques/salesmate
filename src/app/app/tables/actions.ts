"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import {
  COLUMN_TYPES,
  FILLED_BY,
  hasOptions,
  OPTION_COLORS,
  type OptionColor,
  newTableHiddenFields,
  SYSTEM_FIELDS,
  type ColumnDraft,
  type RowKind,
  type SystemField,
} from "@/lib/prospect-columns";
import { queueTableCompletion, rowsAdded } from "@/server/agents/events";
import { workOnAddedRows } from "@/server/agents/runtime";
import { requireBaseAccess, requireRole, requireTenant } from "@/server/auth/session";
import { connections } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { describeConnectorError } from "@/server/connectors/types";
import { proposeAction } from "@/server/gateway/gateway";
import { gatewayDeps } from "@/server/gateway/runtime";
import { getDb } from "@/server/db/client";
import { list, runForm, str } from "@/server/form";
import {
  baseAgents,
  createBase,
  deleteBase,
  getBase,
  moveColumn,
  placeColumn,
  removeColumn,
  renameBase,
  saveColumn,
  setBaseProjects,
  setColumnHidden,
  retryNotFound,
  setColumnWidth,
  setFieldHidden,
} from "@/server/prospects/bases";
import { setIntakeKey } from "@/server/prospects/intake";
import {
  addProspectRow,
  deleteProspects,
  rowEditFromValues,
  searchRows,
  setProspectCell,
  setProspectStatus,
  updateProspectRow,
  type RowEdit,
} from "@/server/prospects/service";
import type { TenantContext } from "@/server/db/tenant";

/** Only owners and admins change the shape of tables; any member edits rows. */
const admin = () => requireRole(["owner", "admin"]);
const tablePath = (baseId: string) => `/app/tables/${baseId}`;
/** Lists and project tabs show tables too: refresh everything under /app. */
const refresh = () => revalidatePath("/app", "layout");

/** Any member edits the rows of the tables they can open (a project's, if it's shared with them). */
async function requireBase(baseId: string) {
  const tenant = await requireTenant();
  const base = await getBase(getDb(), tenant, baseId);
  if (!base) throw new Error("Tabla no encontrada.");
  return requireBaseAccess(base);
}

/** Discards a row, or brings it back. Any member of the organization can. */
export async function changeProspectStatus(baseId: string, ids: string[], status: "new" | "discarded") {
  const tenant = await requireBase(baseId);
  await setProspectStatus(getDb(), tenant, baseId, ids, status);
  revalidatePath(tablePath(baseId));
}

// ---- Bases ------------------------------------------------------------------

/**
 * Creates a table with only the row's name, and opens it: columns (and the
 * fixed fields, like the web) are added on the table itself.
 */
export async function createBaseAction(_: FormState, form: FormData): Promise<FormState> {
  let baseId = "";
  const result = await runForm(async () => {
    const tenant = await admin();
    const rowKind = (str(form, "rowKind") === "person" ? "person" : "company") as RowKind;
    const base = await createBase(getDb(), tenant, str(form, "projectId") ?? null, {
      name: str(form, "name") ?? "",
      rowKind,
      columns: [],
      hiddenFields: newTableHiddenFields(rowKind),
    });
    baseId = base.id;
  });
  if (!result?.ok) return result;
  refresh();
  redirect(tablePath(baseId));
}

export async function renameBaseAction(baseId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    await renameBase(getDb(), await admin(), baseId, str(form, "name") ?? "");
  }, "Nombre guardado.");
  refresh();
  return result;
}

/** The projects that use a table: every project of the account, or the ones picked. */
export async function moveBaseAction(baseId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const all = str(form, "scope") !== "some";
    await setBaseProjects(getDb(), await admin(), baseId, all ? null : list(form, "projectIds"));
  }, "Proyectos guardados.");
  refresh();
  return result;
}

/** Opens the table to web forms with a new key (or replaces the key), or closes it. */
export async function intakeAction(baseId: string, open: boolean, _: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    await setIntakeKey(getDb(), await admin(), baseId, open);
    return open ? "Listo: usa la dirección y la clave nuevas en tu formulario." : "Formulario desconectado.";
  });
  revalidatePath(tablePath(baseId));
  return result;
}

export async function deleteBaseAction(baseId: string) {
  await deleteBase(getDb(), await admin(), baseId);
  refresh();
  redirect("/app/tables");
}

// ---- Columns ----------------------------------------------------------------

/** The choices and their colours, row by row (empty rows dropped). */
function optionsFromForm(form: FormData): Pick<ColumnDraft, "options" | "optionColors"> {
  const names = form.getAll("options").map((o) => String(o).trim());
  const colors = form.getAll("optionColor").map(String);
  const options: string[] = [];
  const optionColors: Record<string, OptionColor> = {};
  names.forEach((name, i) => {
    if (!name) return;
    options.push(name);
    const color = OPTION_COLORS.find((c) => c === colors[i]);
    if (color) optionColors[name] = color;
  });
  return { options, optionColors };
}

function columnFromForm(form: FormData): ColumnDraft {
  const type = COLUMN_TYPES.find((t) => t === str(form, "type")) ?? "text";
  return {
    name: str(form, "name") ?? "",
    type,
    ...(hasOptions(type) ? optionsFromForm(form) : {}),
    ...(type === "link" ? { linkBaseId: str(form, "linkBaseId") } : {}),
    instructions: str(form, "instructions"),
    filledBy: FILLED_BY.find((f) => f === str(form, "filledBy")) ?? "agent",
  };
}

/** Adds a column (no `columnId`) or changes one. */
export async function saveColumnAction(
  baseId: string,
  columnId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const draft = columnFromForm(form);
    const tenant = await admin();
    const { cleared, retried } = await saveColumn(getDb(), tenant, baseId, draft, columnId ?? undefined);
    if (!columnId) {
      const filled = (await baseAgents(getDb(), tenant, baseId)).length > 0;
      return draft.filledBy === "person" || !filled
        ? "Columna añadida."
        : "Columna añadida. El agente la rellenará en las filas que ya hay al completar vacíos.";
    }
    return [
      "Columna guardada.",
      cleared
        ? `${cleared === 1 ? "Se ha borrado 1 valor que ya no encajaba" : `Se han borrado ${cleared} valores que ya no encajaban`} con su tipo.`
        : "",
      retried ? await lookAgain(tenant, baseId, retried) : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
  refresh();
  return result;
}

/**
 * Cells to look for again: the table's agent is asked to complete it (in a
 * few minutes, by the scheduler), and the message says when it will.
 */
async function lookAgain(tenant: TenantContext, baseId: string, n: number): Promise<string> {
  const cells = n === 1 ? "La celda no encontrada se volverá" : `Las ${n} celdas no encontradas se volverán`;
  const { queued, paused } = await queueTableCompletion(getDb(), tenant, baseId);
  if (!queued) return `${cells} a buscar cuando un agente complete la tabla.`;
  if (paused === queued) return `${cells} a buscar cuando actives el agente de la tabla.`;
  return `${cells} a buscar: el agente empieza en unos minutos.`;
}

/** The column's «no encontrado» cells, to be looked for again (now). */
export async function retryNotFoundAction(baseId: string, columnId: string): Promise<string> {
  const tenant = await admin();
  const retried = await retryNotFound(getDb(), tenant, baseId, columnId);
  const message = retried
    ? await lookAgain(tenant, baseId, retried)
    : "No hay celdas sin encontrar en esta columna.";
  refresh();
  return message;
}

/** A column dragged wider or narrower on the table. Anyone who works on the table can. */
export async function setColumnWidthAction(baseId: string, key: string, width: number) {
  await setColumnWidth(getDb(), await requireBase(baseId), baseId, key, width);
}

export async function moveColumnAction(baseId: string, columnId: string, direction: -1 | 1) {
  await moveColumn(getDb(), await admin(), baseId, columnId, direction);
  refresh();
}

/** Drops a dragged column before or after another one. */
export async function placeColumnAction(
  baseId: string,
  columnId: string,
  target: { id: string; side: "before" | "after" },
) {
  await placeColumn(getDb(), await admin(), baseId, columnId, target);
  refresh();
}

/** Shows or hides a fixed field (web, status, sources, date; the company in tables of people). */
export async function toggleFieldAction(baseId: string, field: SystemField, hidden: boolean) {
  if (!SYSTEM_FIELDS.includes(field)) return;
  await setFieldHidden(getDb(), await admin(), baseId, field, hidden);
  refresh();
}

export async function toggleColumnAction(baseId: string, columnId: string, hidden: boolean) {
  await setColumnHidden(getDb(), await admin(), baseId, columnId, hidden);
  refresh();
}

export async function removeColumnAction(baseId: string, columnId: string) {
  await removeColumn(getDb(), await admin(), baseId, columnId);
  refresh();
}

// ---- Rows -------------------------------------------------------------------

/** The agents working on the table that listen to new rows work on this one. */
async function completeNewRow(tenant: TenantContext, baseId: string, rowId: string) {
  return workOnAddedRows(tenant, await rowsAdded(getDb(), tenant, { baseId, rowIds: [rowId] }));
}

type CellValue = string | boolean | string[] | null;

/** A row typed on the table's last line: fixed fields by key, columns by id. */
export async function addRowAction(baseId: string, values: Record<string, CellValue>): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireBase(baseId);
    const row = await addProspectRow(getDb(), tenant, baseId, rowEditFromValues(values));
    return (await completeNewRow(tenant, baseId, row.id))
      ? "Fila añadida. El agente la completará."
      : "Fila añadida.";
  });
  revalidatePath(tablePath(baseId));
  return result;
}

/** One cell typed on the table. */
export async function saveCellAction(
  baseId: string,
  rowId: string,
  key: string,
  value: CellValue,
): Promise<FormState> {
  const result = await runForm(async () => {
    await setProspectCell(getDb(), await requireBase(baseId), baseId, rowId, key, value);
  }, "Guardado.");
  revalidatePath(tablePath(baseId));
  return result;
}

/** Adds a row by hand (no `rowId`) or saves the changes made in the row panel. */
export async function saveRowAction(
  baseId: string,
  rowId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireBase(baseId);
    const db = getDb();
    const base = await getBase(db, tenant, baseId);
    if (!base) throw new Error("Tabla de prospectos no encontrada.");
    const edit: RowEdit = {
      companyName: str(form, "companyName") ?? "",
      personName: str(form, "personName"),
      website: str(form, "website"),
      fields: Object.fromEntries(
        base.columns.map((c) => [
          c.id,
          c.type === "multi" ? list(form, `f:${c.id}`) : (str(form, `f:${c.id}`) ?? null),
        ]),
      ),
    };
    if (!rowId) {
      const row = await addProspectRow(db, tenant, baseId, edit);
      return (await completeNewRow(tenant, baseId, row.id))
        ? "Fila añadida. El agente la completará."
        : "Fila añadida.";
    }
    const { changed } = await updateProspectRow(db, tenant, baseId, rowId, edit);
    return changed ? "Cambios guardados." : "No había cambios.";
  });
  revalidatePath(tablePath(baseId));
  return result;
}

/**
 * Deletes rows, and the rows of other tables that belong to them (the people
 * of a company). Any member who works on the table can; it can't be undone.
 */
export async function deleteRowsAction(baseId: string, ids: string[], back: string) {
  const tenant = await requireBase(baseId);
  await deleteProspects(getDb(), tenant, baseId, ids);
  refresh();
  redirect(back.startsWith(tablePath(baseId)) ? back : tablePath(baseId));
}

/**
 * Rows of the table a relation column points at, by name: the picker of a
 * relation cell. Only the linked table of a table the person can open.
 */
export async function searchLinkRowsAction(baseId: string, q: string) {
  const tenant = await requireBase(baseId);
  const base = await getBase(getDb(), tenant, baseId);
  const target = base?.columns.find((c) => c.type === "link")?.linkBaseId;
  if (!target) return [];
  const rows = await searchRows(getDb(), tenant, target, q);
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    name: r.name,
    detail: r.personName && r.companyName ? r.companyName : null,
  }));
}

/**
 * «Exportar → a otra herramienta»: copies the table to Google Sheets,
 * Airtable, Trello or monday.com, through the gateway (as the person).
 */
export async function sendTableAction(baseId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    // Actions are recorded per project: a table without one exports to CSV only.
    const projectId = (await getBase(db, tenant, baseId))?.projectId;
    if (!projectId) throw new Error("Esta tabla no es de ningún proyecto: expórtala a Excel (CSV).");
    const connectionId = str(form, "connectionId");
    if (!connectionId) throw new Error("Elige a dónde exportar.");
    const [connection] = await withTenant(db, tenant, (tx) =>
      tx.select().from(connections).where(eq(connections.id, connectionId)),
    );
    if (!connection) throw new Error("Conexión no encontrada.");
    const targetLabel = str(form, "targetLabel");
    const sent = await proposeAction(gatewayDeps(), tenant, {
      projectId,
      type: "table.export",
      payload: {
        connectionId,
        baseId,
        include: str(form, "include") === "pending" ? "pending" : "all",
        target: str(form, "target") ?? null,
        destination: [connection.label, targetLabel].filter(Boolean).join(" › "),
      },
      reason: "Exportación pedida por una persona del equipo",
      // Every click is a new export.
      idempotencyKey: `table.export:${baseId}:${Date.now()}`,
    });
    if (sent.outcome !== "executed") {
      throw new Error(
        sent.action.error
          ? describeConnectorError(sent.action.error)
          : `No se ha podido exportar (${sent.outcome}).`,
      );
    }
    const out = (sent.action.result ?? {}) as { count?: number; url?: string | null };
    return out.count
      ? `Exportadas ${out.count} filas a ${connection.label}${out.url ? `: ${out.url}` : "."}`
      : "No había filas que exportar.";
  });
  revalidatePath(tablePath(baseId));
  return result;
}
