"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole, requireTenant } from "@/server/auth/session";
import { getAvailability } from "@/server/calendar/availability";
import {
  linkConnectionToProject,
  setProjectIdentity,
  unlinkConnectionFromProject,
} from "@/server/connectors/service";
import { getDb } from "@/server/db/client";
import { AGENT_TYPES, type AgentType } from "@/server/db/schema";
import { bool, list, num, runForm, str } from "@/server/form";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import {
  deleteSource,
  ingestDocumentFile,
  ingestDocumentText,
  ingestTableFile,
  searchKnowledge,
  updateSource,
} from "@/server/knowledge/service";
import {
  addComplianceRule,
  addSuppression,
  createMeetingType,
  deleteMeetingType,
  removeComplianceRule,
  removeSuppression,
  setProjectState,
  updateAgentConfig,
  updateProject,
} from "@/server/services/projects";
import { formatSlot } from "@/lib/format";

const admin = () => requireRole(["owner", "admin"]);
const refresh = (projectId: string) => revalidatePath(`/app/projects/${projectId}`, "layout");

// General -------------------------------------------------------------------

export async function saveProject(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const from = str(form, "sendFrom");
    const to = str(form, "sendTo");
    await updateProject(getDb(), tenant, projectId, {
      name: str(form, "name") ?? "",
      description: str(form, "description"),
      website: str(form, "website") ?? "",
      timezone: str(form, "timezone") ?? "Europe/Madrid",
      languages: (str(form, "languages") ?? "es")
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
      settings: {
        sendWindow: from && to ? [from, to] : undefined,
        sendDays: list(form, "sendDays").map(Number),
        crossProjectCooldownDays: num(form, "cooldown"),
      },
    });
    refresh(projectId);
  });
}

export async function toggleAgents(projectId: string, paused: boolean) {
  const tenant = await admin();
  await setProjectState(getDb(), tenant, projectId, { agentsPaused: paused });
  refresh(projectId);
}

// Channels ------------------------------------------------------------------

export async function saveIdentities(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const all = list(form, "all");
    const selected = new Set(list(form, "identity"));
    const defaults = new Set(list(form, "default"));
    for (const identityId of all) {
      await setProjectIdentity({ db: getDb() }, tenant, {
        projectId,
        identityId,
        assigned: selected.has(identityId),
        isDefault: defaults.has(identityId),
      });
    }
    refresh(projectId);
  });
}

export async function saveConnectionLink(
  projectId: string,
  connectionId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    const capabilities = list(form, "capability");
    if (capabilities.length === 0) {
      await unlinkConnectionFromProject({ db: getDb() }, tenant, { projectId, connectionId });
      refresh(projectId);
      return "Conexión desvinculada del proyecto.";
    }
    const granted = await linkConnectionToProject({ db: getDb() }, tenant, {
      projectId,
      connectionId,
      capabilities,
    });
    refresh(projectId);
    return `Capacidades activas: ${granted.join(", ") || "ninguna"}.`;
  });
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
    const reliability = str(form, "reliability") === "truth" ? "truth" : "reference";
    const kind = str(form, "kind");
    const text = str(form, "text");
    const name = str(form, "name");
    if (kind === "text") {
      if (!text || !name) throw new Error("Escribe un nombre y el texto.");
      const { chunks } = await ingestDocumentText(getDb(), tenant, { projectId, name, reliability, text });
      refresh(projectId);
      return `Texto añadido (${chunks} fragmentos).`;
    }
    const file = fileFrom(form);
    const data = Buffer.from(await file.arrayBuffer());
    const isTable = /\.(csv|tsv|xlsx)$/i.test(file.name);
    if (isTable) {
      const { tables } = await ingestTableFile(getDb(), tenant, {
        projectId,
        name: name ?? file.name,
        reliability,
        filename: file.name,
        data,
      });
      refresh(projectId);
      return `Tabla importada: ${tables.map((t) => `${t.name} (${t.rowCount} filas)`).join(", ")}.`;
    }
    const { chunks } = await ingestDocumentFile(getDb(), tenant, {
      projectId,
      name: name ?? file.name,
      reliability,
      kind: kind === "examples" ? "examples" : "document",
      filename: file.name,
      data,
    });
    refresh(projectId);
    return `Documento añadido (${chunks} fragmentos).`;
  });
}

export async function setSourceReliability(
  projectId: string,
  sourceId: string,
  reliability: "truth" | "reference",
) {
  const tenant = await admin();
  await updateSource(getDb(), tenant, sourceId, { reliability });
  refresh(projectId);
}

export async function validateSource(projectId: string, sourceId: string, validated: boolean) {
  const tenant = await admin();
  await updateSource(getDb(), tenant, sourceId, { validated });
  refresh(projectId);
}

export async function removeSource(projectId: string, sourceId: string) {
  const tenant = await admin();
  await deleteSource(getDb(), tenant, sourceId);
  refresh(projectId);
}

export type SearchState = { query: string; hits: Awaited<ReturnType<typeof searchKnowledge>> } | null;

export async function searchProjectKnowledge(
  projectId: string,
  _: SearchState,
  form: FormData,
): Promise<SearchState> {
  const tenant = await requireTenant();
  const query = str(form, "q") ?? "";
  const hits = query ? await searchKnowledge(getDb(), tenant, { projectId, query, limit: 6 }) : [];
  return { query, hits };
}

// Rules ---------------------------------------------------------------------

export async function saveAgent(
  projectId: string,
  agentType: AgentType,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  return runForm(async () => {
    if (!AGENT_TYPES.includes(agentType)) throw new Error("Agente desconocido.");
    const tenant = await admin();
    const actionLevels: Record<string, number> = {};
    const dailyLimits: Record<string, number> = {};
    for (const type of Object.keys(ACTION_DEFINITIONS)) {
      const level = str(form, `level:${type}`);
      if (level !== undefined && level !== "default") actionLevels[type] = Number(level);
      const limit = num(form, `limit:${type}`);
      if (limit !== undefined) dailyLimits[type] = limit;
    }
    await updateAgentConfig(getDb(), tenant, projectId, agentType, {
      enabled: bool(form, "enabled"),
      defaultLevel: num(form, "defaultLevel") ?? 1,
      actionLevels,
      dailyLimits,
    });
    refresh(projectId);
  });
}

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
