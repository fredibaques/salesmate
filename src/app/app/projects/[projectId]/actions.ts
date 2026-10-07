"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole, requireTenant } from "@/server/auth/session";
import { getAvailability } from "@/server/calendar/availability";
import { getDb } from "@/server/db/client";
import { list, num, runForm, str } from "@/server/form";
import { answerFromKnowledge } from "@/server/agents/knowledge-answer";
import {
  deleteSource,
  ingestDocumentFile,
  ingestDocumentText,
  ingestTableFile,
} from "@/server/knowledge/service";
import { LlmProviderError } from "@/server/llm/errors";
import { orgLlm } from "@/server/llm/org-ai";
import {
  addComplianceRule,
  addSuppression,
  createMeetingType,
  deleteProject,
  deleteMeetingType,
  removeComplianceRule,
  removeSuppression,
  setProjectState,
  updateProject,
} from "@/server/services/projects";
import { formatSlot } from "@/lib/format";
import { projectFromForm } from "../profile-form";

const admin = () => requireRole(["owner", "admin"]);
const refresh = (projectId: string) => revalidatePath(`/app/projects/${projectId}`, "layout");
/** The project's name and paused state also show in the sidebar. */
const refreshSidebar = () => revalidatePath("/app", "layout");

// General -------------------------------------------------------------------

export async function saveProject(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const from = str(form, "sendFrom");
    const to = str(form, "sendTo");
    await updateProject(getDb(), tenant, projectId, {
      ...projectFromForm(form),
      settings: {
        sendWindow: from && to ? [from, to] : undefined,
        sendDays: list(form, "sendDays").map(Number),
        crossProjectCooldownDays: num(form, "cooldown"),
      },
    });
    refreshSidebar();
  });
}

export async function deleteProjectAction(
  projectId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await deleteProject(getDb(), tenant, projectId, str(form, "confirmName") ?? "");
  });
  if (result?.ok) {
    refreshSidebar();
    redirect("/app");
  }
  return result;
}

export async function toggleAgents(projectId: string, paused: boolean) {
  const tenant = await admin();
  await setProjectState(getDb(), tenant, projectId, { agentsPaused: paused });
  refreshSidebar();
}

// Meetings ------------------------------------------------------------------

export async function addMeetingType(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    await createMeetingType(getDb(), tenant, projectId, {
      name: str(form, "name") ?? "",
      kind: (str(form, "kind") ?? "custom") as "custom",
      durationMinutes: num(form, "duration") ?? 30,
      bufferBeforeMinutes: num(form, "bufferBefore") ?? 0,
      bufferAfterMinutes: num(form, "bufferAfter") ?? 10,
      minNoticeMinutes: (num(form, "minNoticeHours") ?? 4) * 60,
      horizonDays: num(form, "horizonDays") ?? 14,
      slotStepMinutes: num(form, "step") ?? 30,
      days: list(form, "days") as ("mon" | "tue")[],
      from: str(form, "from") ?? "09:00",
      to: str(form, "to") ?? "18:00",
      hostUserId: tenant.userId,
      calendarIdentityId: str(form, "calendarIdentityId"),
      location: str(form, "location"),
    });
    refresh(projectId);
  }, "Tipo de reunión creado.");
}

export async function removeMeetingType(projectId: string, meetingTypeId: string) {
  const tenant = await admin();
  await deleteMeetingType(getDb(), tenant, meetingTypeId);
  refresh(projectId);
}

export async function previewAvailability(
  meetingTypeId: string,
  timezone: string,
  _: FormState,
): Promise<FormState> {
  return runForm(async () => {
    const tenant = await requireTenant();
    const { slots, warnings } = await getAvailability({ db: getDb() }, tenant, meetingTypeId);
    const next = slots.slice(0, 8).map((s) => formatSlot(s.start, timezone));
    return [
      next.length ? `Próximos huecos: ${next.join(" · ")}` : "No hay huecos en el horizonte configurado.",
      ...warnings.map((w) => `⚠ ${w}`),
    ].join("  ");
  });
}

// Knowledge -----------------------------------------------------------------

function fileFrom(form: FormData): File {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Selecciona un fichero.");
  return file;
}

export async function uploadKnowledge(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const kind = str(form, "kind");
    const text = str(form, "text");
    const name = str(form, "name");
    if (kind === "text") {
      if (!text || !name) throw new Error("Escribe un nombre y el texto.");
      await ingestDocumentText(getDb(), tenant, { projectId, name, text });
      refresh(projectId);
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
      refresh(projectId);
      return `«${title}» añadido: ${tables.length === 1 ? "1 tabla" : `${tables.length} tablas`}.`;
    }
    await ingestDocumentFile(getDb(), tenant, {
      projectId,
      name: title,
      kind: kind === "examples" ? "examples" : "document",
      filename: file.name,
      data,
    });
    refresh(projectId);
    return `«${title}» añadido.`;
  });
}

export async function removeSource(projectId: string, sourceId: string) {
  const tenant = await admin();
  await deleteSource(getDb(), tenant, sourceId);
  refresh(projectId);
  redirect(`/app/projects/${projectId}/knowledge`);
}

export type AskState =
  | { question: string; answer: string; sources: { id: string; name: string; kind: string }[] }
  | { question: string; error: string }
  | null;

export async function askKnowledge(projectId: string, _: AskState, form: FormData): Promise<AskState> {
  const question = str(form, "q") ?? "";
  if (!question) return null;
  try {
    const tenant = await requireTenant();
    const db = getDb();
    const llm = await orgLlm(db, tenant);
    if (!llm) {
      return { question, error: "Conecta tu proveedor de IA en Configuración → IA para usar esta función." };
    }
    const result = await answerFromKnowledge(
      { db, llm },
      { orgId: tenant.orgId, userId: tenant.userId },
      { projectId, question },
    );
    return { question, answer: result.answer, sources: result.sources };
  } catch (err) {
    console.error(err);
    if (err instanceof LlmProviderError) return { question, error: err.message };
    return { question, error: "No he podido responder ahora mismo. Inténtalo de nuevo en un momento." };
  }
}

// Rules ---------------------------------------------------------------------

export async function addRule(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const kind = str(form, "kind");
    const description = str(form, "description") ?? "";
    const actionTypes = list(form, "actionTypes");
    const base = { description, actionTypes };
    const input =
      kind === "mandatory_notice"
        ? { kind, ...base, text: str(form, "text") ?? "" }
        : kind === "channel_restriction"
          ? { kind, ...base, customerTypes: list(form, "customerTypes") as ("b2b" | "b2c")[] }
          : kind === "retention"
            ? { kind, description, days: num(form, "days") ?? 365 }
            : { kind: "human_only" as const, ...base };
    await addComplianceRule(getDb(), tenant, projectId, input as never);
    refresh(projectId);
  }, "Regla añadida.");
}

export async function deleteRule(projectId: string, ruleId: string) {
  const tenant = await admin();
  await removeComplianceRule(getDb(), tenant, ruleId);
  refresh(projectId);
}

export async function addProjectSuppression(
  projectId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const type = (str(form, "type") ?? "email") as "email" | "domain" | "phone";
    const values = (str(form, "values") ?? "").split(/[\s,;]+/).filter(Boolean);
    if (values.length === 0) throw new Error("Escribe al menos un valor.");
    for (const value of values) {
      await addSuppression(getDb(), tenant, {
        projectId: form.get("scope") === "global" ? null : projectId,
        type,
        value,
        reason: str(form, "reason"),
      });
    }
    refresh(projectId);
    return `${values.length} exclusión(es) añadida(s).`;
  });
}

export async function deleteSuppression(projectId: string, suppressionId: string) {
  const tenant = await admin();
  await removeSuppression(getDb(), tenant, suppressionId);
  refresh(projectId);
}
