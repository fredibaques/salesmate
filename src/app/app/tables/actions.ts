"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { FormState } from "@/components/action-form";
import {
  COLUMN_TYPES,
  DEFAULT_COLUMNS,
  FILLED_BY,
  newTableHiddenFields,
  SYSTEM_FIELDS,
  type ColumnDraft,
  type RowKind,
  type SystemField,
} from "@/lib/prospect-columns";
import { processAgentEvents, rowsAdded } from "@/server/agents/events";
import { agentRunDeps } from "@/server/agents/runtime";
import { requireRole, requireTenant } from "@/server/auth/session";
import { connections } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { describeConnectorError } from "@/server/connectors/types";
import { proposeAction } from "@/server/gateway/gateway";
import { gatewayDeps } from "@/server/gateway/runtime";
import { getDb } from "@/server/db/client";
import { list, num, runForm, str } from "@/server/form";
import { orgLlm } from "@/server/llm/org-ai";
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
  setBaseProject,
  setColumnHidden,
  setFieldHidden,
} from "@/server/prospects/bases";
import { setIntakeKey } from "@/server/prospects/intake";
import { proposeColumns, type ProposedColumn } from "@/server/prospects/propose-columns";
import {
  addProspectRow,
  rowEditFromValues,
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

/** Discards a row, or brings it back. Any member of the organization can. */
export async function changeProspectStatus(baseId: string, ids: string[], status: "new" | "discarded") {
  const tenant = await requireTenant();
  await setProspectStatus(getDb(), tenant, baseId, ids, status);
  revalidatePath(tablePath(baseId));
}

// ---- Bases ------------------------------------------------------------------

/**
 * Columns for a table: proposed by the AI (from its project's offer and
 * ideal customer, when it has a project), or the default ones when the AI
 * isn't connected.
 */
export async function proposeColumnsAction(
  projectId: string | null,
  input: { rowKind: RowKind; name: string; brief: string },
): Promise<{ ok: boolean; message?: string; columns: ProposedColumn[] }> {
  const tenant = await admin();
  const db = getDb();
  const defaults = DEFAULT_COLUMNS[input.rowKind].map((c) => ({ ...c, recommended: true }));
  const llm = await orgLlm(db, tenant).catch(() => null);
  if (!llm) {
    return {
      ok: false,
      message: "Conecta la IA para que proponga columnas a tu medida. Mientras, tienes las de siempre.",
      columns: defaults,
    };
  }
  try {
    const columns = await proposeColumns({ db, llm }, tenant, {
      projectId,
      rowKind: input.rowKind,
      name: input.name || "Prospectos",
      brief: input.brief,
    });
    return columns.length
      ? { ok: true, columns }
      : { ok: false, message: "La IA no ha propuesto columnas.", columns: defaults };
  } catch (err) {
    return {
      ok: false,
      message: `No se han podido proponer columnas (${err instanceof Error ? err.message : String(err)}). Tienes las de siempre.`,
      columns: defaults,
    };
  }
}

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

/** Moves a table to a project, or leaves it on its own. */
export async function moveBaseAction(baseId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    await setBaseProject(getDb(), await admin(), baseId, str(form, "projectId") ?? null);
  }, "Proyecto guardado.");
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
  const base = await deleteBase(getDb(), await admin(), baseId);
  refresh();
  redirect(base.projectId ? `/app/projects/${base.projectId}/prospects` : "/app/tables");
}

// ---- Columns ----------------------------------------------------------------

function columnFromForm(form: FormData): ColumnDraft {
  const type = COLUMN_TYPES.find((t) => t === str(form, "type")) ?? "text";
  return {
    name: str(form, "name") ?? "",
    type,
    options: type === "select" || type === "multi" ? list(form, "options").map((o) => o.trim()) : undefined,
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
    const { cleared } = await saveColumn(getDb(), tenant, baseId, draft, columnId ?? undefined);
    if (!columnId) {
      const filled = (await baseAgents(getDb(), tenant, baseId)).length > 0;
      return draft.filledBy === "person" || !filled
        ? "Columna añadida."
        : "Columna añadida. El agente la rellenará en las filas que ya hay al completar vacíos.";
    }
    return cleared
      ? `Columna guardada. ${cleared === 1 ? "Se ha borrado 1 valor que ya no encajaba" : `Se han borrado ${cleared} valores que ya no encajaban`} con su tipo.`
      : "Columna guardada.";
  });
  refresh();
  return result;
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

/** Shows or hides a fixed field (web, fit, status, sources; the company in tables of people). */
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

/** The agent that fills the table completes a new row, if it listens to new rows. */
async function completeNewRow(tenant: TenantContext, baseId: string, rowId: string) {
  const db = getDb();
  const agentId = await rowsAdded(db, tenant, { baseId, rowIds: [rowId] });
  if (!agentId) return false;
  after(async () => {
    try {
      const llm = await orgLlm(db, tenant);
      if (llm) await processAgentEvents(agentRunDeps(llm), tenant, agentId);
    } catch (err) {
      console.error("new-row run failed", err);
    }
  });
  return true;
}

type CellValue = string | boolean | string[] | null;

/** A row typed on the table's last line: fixed fields by key, columns by id. */
export async function addRowAction(baseId: string, values: Record<string, CellValue>): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireTenant();
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
    await setProspectCell(getDb(), await requireTenant(), baseId, rowId, key, value);
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
    const tenant = await requireTenant();
    const db = getDb();
    const base = await getBase(db, tenant, baseId);
    if (!base) throw new Error("Tabla de prospectos no encontrada.");
    const fit = str(form, "fitScore");
    const edit: RowEdit = {
      companyName: str(form, "companyName") ?? "",
      personName: str(form, "personName"),
      website: str(form, "website"),
      fitScore: fit === undefined ? null : num(form, "fitScore"),
      fitReason: str(form, "fitReason"),
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
