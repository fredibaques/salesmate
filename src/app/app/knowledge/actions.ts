"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { importFromGoogle } from "@/server/knowledge/google-import";
import {
  deleteSource,
  ingestDocumentFile,
  ingestDocumentText,
  ingestTableFile,
  setSourceProject,
  updateSourceText,
} from "@/server/knowledge/service";

/**
 * Knowledge of a project, or of the whole account (`projectId` null): what
 * agents read before answering. Account knowledge is used by every project.
 */

const admin = () => requireRole(["owner", "admin"]);
/** Account knowledge shows in every project: refresh everything under /app. */
const refresh = () => revalidatePath("/app", "layout");
const listPath = (projectId: string | null) =>
  projectId ? `/app/projects/${projectId}/knowledge` : "/app/knowledge";

function fileFrom(form: FormData): File {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Selecciona un fichero.");
  return file;
}

/** Imports a Google Doc or Sheet (a copy). */
export async function importGoogleKnowledge(
  projectId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const imported = await importFromGoogle({ db: getDb() }, tenant, {
      projectId,
      url: str(form, "url") ?? "",
      name: str(form, "name"),
    });
    refresh();
    return imported.kind === "doc"
      ? `«${imported.name}» añadido.`
      : `«${imported.name}» añadido: ${imported.tables === 1 ? "1 tabla" : `${imported.tables} tablas`}.`;
  });
}

export async function uploadKnowledge(
  projectId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const kind = str(form, "kind");
    const text = str(form, "text");
    const name = str(form, "name");
    if (kind === "text") {
      if (!text || !name) throw new Error("Escribe un nombre y el texto.");
      await ingestDocumentText(getDb(), tenant, { projectId, name, text });
      refresh();
      return `«${name}» añadido.`;
    }
    const file = fileFrom(form);
    const data = Buffer.from(await file.arrayBuffer());
    const title = name ?? file.name.replace(/\.[^.]+$/, "");
    if (/\.(csv|tsv|xlsx)$/i.test(file.name)) {
      const { tables } = await ingestTableFile(getDb(), tenant, {
        projectId,
        name: title,
        filename: file.name,
        data,
      });
      refresh();
      return `«${title}» añadido: ${tables.length === 1 ? "1 tabla" : `${tables.length} tablas`}.`;
    }
    await ingestDocumentFile(getDb(), tenant, {
      projectId,
      name: title,
      kind: kind === "examples" ? "examples" : "document",
      filename: file.name,
      data,
    });
    refresh();
    return `«${title}» añadido.`;
  });
}

export async function removeSource(sourceId: string) {
  const row = await deleteSource(getDb(), await admin(), sourceId);
  refresh();
  redirect(listPath(row.projectId));
}

/** Moves a source to a project, or to the whole account, and opens it there. */
export async function moveSourceAction(sourceId: string, _: FormState, form: FormData): Promise<FormState> {
  const projectId = str(form, "projectId") ?? null;
  const result = await runForm(async () => {
    await setSourceProject(getDb(), await admin(), sourceId, projectId);
  });
  if (!result?.ok) return result;
  refresh();
  redirect(`${listPath(projectId)}/${sourceId}`);
}

/** Saves a new version of text knowledge (its name and its text). */
export async function editSourceText(sourceId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    await updateSourceText(getDb(), await admin(), sourceId, {
      name: str(form, "name") ?? "",
      // Kept as typed: str() trims, and the text's own spacing matters.
      text: String(form.get("text") ?? ""),
    });
  }, "Conocimiento guardado.");
  refresh();
  return result;
}
