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
  type ColumnDraft,
  type RowKind,
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
  createBase,
  deleteBase,
  getBase,
  moveColumn,
  removeColumn,
  renameBase,
  saveColumn,
  setColumnHidden,
} from "@/server/prospects/bases";
import { proposeColumns, type ProposedColumn } from "@/server/prospects/propose-columns";
import {
  addProspectRow,
  setProspectStatus,
  updateProspectRow,
  type RowEdit,
} from "@/server/prospects/service";

/** Only owners and admins change the shape of bases; any member edits rows. */
const admin = () => requireRole(["owner", "admin"]);
const basesPath = (projectId: string) => `/app/projects/${projectId}/prospects`;
const refresh = (projectId: string) => revalidatePath(basesPath(projectId), "layout");

/** Discards a row, or brings it back. Any member of the organization can. */
export async function changeProspectStatus(
  projectId: string,
  baseId: string,
  ids: string[],
  status: "new" | "discarded",
) {
  const tenant = await requireTenant();
  await setProspectStatus(getDb(), tenant, baseId, ids, status);
  revalidatePath(`${basesPath(projectId)}/${baseId}`);
}

// ---- Bases ------------------------------------------------------------------

/**
 * Columns for a new base: proposed by the AI from the project's offer and
 * ideal customer, or the default ones when the AI isn't connected.
 */
export async function proposeColumnsAction(
  projectId: string,
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

/** Creates a base from the wizard and opens it. */
export async function createBaseAction(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  let baseId = "";
  const result = await runForm(async () => {
    const tenant = await admin();
    const columns = JSON.parse(str(form, "columns") ?? "[]") as ColumnDraft[];
    const base = await createBase(getDb(), tenant, projectId, {
      name: str(form, "name") ?? "",
      rowKind: str(form, "rowKind") ?? "company",
      columns,
    });
    baseId = base.id;
  });
  if (!result?.ok) return result;
  refresh(projectId);
  redirect(`${basesPath(projectId)}/${baseId}`);
}

export async function renameBaseAction(
  projectId: string,
  baseId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    await renameBase(getDb(), await admin(), baseId, str(form, "name") ?? "");
  }, "Nombre guardado.");
  refresh(projectId);
  return result;
}

export async function deleteBaseAction(projectId: string, baseId: string) {
  await deleteBase(getDb(), await admin(), baseId);
  refresh(projectId);
  redirect(basesPath(projectId));
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
  projectId: string,
  baseId: string,
  columnId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const draft = columnFromForm(form);
    const { cleared } = await saveColumn(getDb(), await admin(), baseId, draft, columnId ?? undefined);
    if (!columnId) {
      return draft.filledBy === "person"
        ? "Columna añadida."
        : "Columna añadida. El agente la rellenará en las filas que ya hay al completar vacíos.";
    }
    return cleared
      ? `Columna guardada. ${cleared === 1 ? "Se ha borrado 1 valor que ya no encajaba" : `Se han borrado ${cleared} valores que ya no encajaban`} con su tipo.`
      : "Columna guardada.";
  });
  refresh(projectId);
  return result;
}

export async function moveColumnAction(
  projectId: string,
  baseId: string,
  columnId: string,
  direction: -1 | 1,
) {
  await moveColumn(getDb(), await admin(), baseId, columnId, direction);
  refresh(projectId);
}

export async function toggleColumnAction(
  projectId: string,
  baseId: string,
  columnId: string,
  hidden: boolean,
) {
  await setColumnHidden(getDb(), await admin(), baseId, columnId, hidden);
  refresh(projectId);
}

export async function removeColumnAction(projectId: string, baseId: string, columnId: string) {
  await removeColumn(getDb(), await admin(), baseId, columnId);
  refresh(projectId);
}

// ---- Rows -------------------------------------------------------------------

/** Adds a row by hand (no `rowId`) or saves the changes made in the row panel. */
export async function saveRowAction(
  projectId: string,
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
      // The agent that fills the base completes it, if it listens to new rows.
      const agentId = await rowsAdded(db, tenant, { baseId, rowIds: [row.id] });
      if (agentId) {
        after(async () => {
          try {
            const llm = await orgLlm(db, tenant);
            if (llm) await processAgentEvents(agentRunDeps(llm), tenant, agentId);
          } catch (err) {
            console.error("new-row run failed", err);
          }
        });
        return "Fila añadida. El agente la completará.";
      }
      return "Fila añadida.";
    }
    const { changed } = await updateProspectRow(db, tenant, baseId, rowId, edit);
    return changed ? "Cambios guardados." : "No había cambios.";
  });
  revalidatePath(`${basesPath(projectId)}/${baseId}`);
  return result;
}

/**
 * «Exportar → a otra herramienta»: copies the table to Google Sheets,
 * Airtable, Trello or monday.com, through the gateway (as the person).
 */
export async function sendTableAction(
  projectId: string,
  baseId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
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
  revalidatePath(`${basesPath(projectId)}/${baseId}`);
  return result;
}
