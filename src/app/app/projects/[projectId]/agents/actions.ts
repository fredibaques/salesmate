"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { SALES_MOTIONS, type SalesMotion } from "@/server/db/schema";
import { bool, list, num, runForm, str } from "@/server/form";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { getLlm } from "@/server/llm/client";
import { draftPlaybook } from "@/server/playbooks/draft";
import { AGENT_PROCESS_FIELDS, NEXT_STEPS, type NextStep, type PlaybookSpec } from "@/server/playbooks/spec";
import { runProspecting } from "@/server/agents/prospector";
import { closeStaleRuns } from "@/server/agents/scheduler";
import { agentRunDeps } from "@/server/agents/runtime";
import { isLlmConfigured } from "@/server/llm/client";
import { setProspectStatus } from "@/server/prospects/service";
import {
  addAgent,
  getAgent,
  isProjectAgentType,
  listAgentRuns,
  removeAgent,
  saveAgentChannels,
  saveAgentInstructions,
  saveAgentProcess,
  saveAgentTools,
  SCHEDULED_AGENT_TYPES,
  setAgentEnabled,
  updateAgentAutonomy,
  type ProjectAgentType,
} from "@/server/services/agents";

const admin = () => requireRole(["owner", "admin"]);
const refresh = (projectId: string) => revalidatePath(`/app/projects/${projectId}`, "layout");
const lines = (form: FormData, key: string) =>
  (str(form, key) ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function agentType(value: string): ProjectAgentType {
  if (!isProjectAgentType(value)) throw new Error("Agente desconocido.");
  return value;
}

function salesMotion(form: FormData): SalesMotion {
  const motion = str(form, "salesMotion") as SalesMotion;
  if (!SALES_MOTIONS.includes(motion)) throw new Error("Elige un modelo de venta.");
  return motion;
}

export async function addAgentAction(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  let added: ProjectAgentType | undefined;
  const result = await runForm(async () => {
    const tenant = await admin();
    const type = agentType(str(form, "agentType") ?? "");
    await addAgent(getDb(), tenant, projectId, type, salesMotion(form));
    added = type;
  });
  if (added) {
    refresh(projectId);
    redirect(`/app/projects/${projectId}/agents/${added}`);
  }
  return result;
}

export async function removeAgentAction(projectId: string, type: string) {
  const tenant = await admin();
  await removeAgent(getDb(), tenant, projectId, agentType(type));
  refresh(projectId);
  redirect(`/app/projects/${projectId}/agents`);
}

export async function toggleAgent(projectId: string, type: string, enabled: boolean) {
  const tenant = await admin();
  await setAgentEnabled(getDb(), tenant, projectId, agentType(type), enabled);
  refresh(projectId);
}

/** Reads the process form: one main outcome, then alternatives in catalog order. */
function processFromForm(form: FormData): Partial<PlaybookSpec> {
  const primary = str(form, "primaryStep") as NextStep | undefined;
  if (!primary || !NEXT_STEPS.includes(primary)) throw new Error("Elige cómo debe terminar la conversación.");
  const alternatives = NEXT_STEPS.filter((s) => s !== primary && list(form, "alternativeSteps").includes(s));
  return {
    customerType: str(form, "customerType") === "b2c" ? "b2c" : "b2b",
    objective: str(form, "objective") ?? "",
    nextSteps: [primary, ...alternatives],
    meetingTypeId: str(form, "meetingTypeId"),
    qualification: lines(form, "qualification").map((l) => ({
      criterion: l.replace(/^\*\s*/, ""),
      required: l.startsWith("*"),
    })),
    disqualifiers: lines(form, "disqualifiers"),
    requiredData: lines(form, "requiredData"),
    rules: lines(form, "rules"),
    handoff: lines(form, "handoff"),
    responseTimeMinutes: num(form, "responseTimeMinutes") ?? 15,
  };
}

export async function saveProcess(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const row = await saveAgentProcess(getDb(), tenant, projectId, agentType(type), {
      salesMotion: salesMotion(form),
      process: processFromForm(form),
      notes: str(form, "notes"),
    });
    return `Proceso guardado (versión ${row.currentVersion}).`;
  });
  refresh(projectId);
  return result;
}

export async function draftProcess(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const kind = agentType(type);
    const agent = await getAgent(db, tenant, projectId, kind);
    if (!agent?.process) throw new Error("Agente no encontrado.");
    const { spec, gaps } = await draftPlaybook({ db, llm: getLlm() }, tenant, {
      projectId,
      salesMotion: agent.process.salesMotion,
      current: agent.process.spec,
      instructions: str(form, "instructions"),
    });
    const process = Object.fromEntries(
      AGENT_PROCESS_FIELDS.map((f) => [f, spec[f]]),
    ) as Partial<PlaybookSpec>;
    // Keep the meeting type the user chose: the draft can't know it.
    process.meetingTypeId = agent.process.spec.meetingTypeId;
    const row = await saveAgentProcess(db, tenant, projectId, kind, {
      process,
      notes: `Propuesta de la IA${gaps.length ? `. Falta: ${gaps.join("; ")}` : ""}`,
    });
    return `Propuesta guardada como versión ${row.currentVersion}.${gaps.length ? ` Revisa lo que falta: ${gaps.join(" · ")}` : ""}`;
  });
  refresh(projectId);
  return result;
}

export async function saveChannels(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await saveAgentChannels(getDb(), tenant, projectId, agentType(type), {
      mailboxId: str(form, "mailboxId") ?? null,
      readMailbox: bool(form, "readMailbox"),
      calendarId: str(form, "calendarId") ?? null,
      crmConnectionId: str(form, "crmConnectionId") ?? null,
    });
  }, "Canales guardados.");
  refresh(projectId);
  return result;
}

export async function saveAutonomy(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const actionLevels: Record<string, number> = {};
    const dailyLimits: Record<string, number> = {};
    for (const action of Object.keys(ACTION_DEFINITIONS)) {
      const level = str(form, `level:${action}`);
      if (level !== undefined && level !== "default") actionLevels[action] = Number(level);
      const limit = num(form, `limit:${action}`);
      if (limit !== undefined) dailyLimits[action] = limit;
    }
    await updateAgentAutonomy(getDb(), tenant, projectId, agentType(type), {
      defaultLevel: num(form, "defaultLevel") ?? 1,
      actionLevels,
      dailyLimits,
    });
  });
  refresh(projectId);
  return result;
}

export async function saveInstructions(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const kind = agentType(type);
    const scheduled = SCHEDULED_AGENT_TYPES.includes(kind);
    await saveAgentInstructions(getDb(), tenant, projectId, kind, {
      instructions: str(form, "instructions") ?? "",
      schedule: scheduled
        ? { time: str(form, "time") ?? "08:00", days: list(form, "days").map(Number) }
        : null,
      settings: scheduled ? { prospectsPerRun: num(form, "prospectsPerRun") ?? 10 } : {},
    });
  }, "Instrucciones guardadas.");
  refresh(projectId);
  return result;
}

export async function saveTools(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    // Each checked MCP tool arrives as "<connectionId>::<tool name>".
    const byServer = new Map<string, string[]>();
    for (const value of list(form, "mcp")) {
      const [connectionId, ...rest] = value.split("::");
      const tool = rest.join("::");
      if (!connectionId || !tool) continue;
      byServer.set(connectionId, [...(byServer.get(connectionId) ?? []), tool]);
    }
    await saveAgentTools(getDb(), tenant, projectId, agentType(type), {
      web: bool(form, "web"),
      mcp: [...byServer].map(([connectionId, tools]) => ({ connectionId, tools })),
    });
  }, "Herramientas guardadas.");
  refresh(projectId);
  return result;
}

/** Starts a prospecting run now; it keeps going after the response (results appear as they are saved). */
export async function runProspectingNow(projectId: string, _: FormState): Promise<FormState> {
  return runForm(async () => {
    const tenant = await admin();
    if (!isLlmConfigured()) throw new Error("La IA no está configurada todavía (falta ANTHROPIC_API_KEY).");
    const db = getDb();
    await closeStaleRuns(db, new Date());
    const [last] = await listAgentRuns(db, tenant, projectId, "outbound", 1);
    if (last?.status === "running") throw new Error("Ya está buscando. Espera a que termine (unos minutos).");
    after(async () => {
      try {
        await runProspecting(agentRunDeps(), tenant, {
          projectId,
          trigger: "manual",
          triggerRef: tenant.userId,
        });
      } catch (err) {
        console.error("prospecting run failed", err);
      }
    });
    return "En marcha. Los prospectos irán apareciendo aquí en unos minutos; recarga la página para verlos.";
  });
}

export async function changeProspects(projectId: string, ids: string[], status: "new" | "discarded") {
  const tenant = await admin();
  await setProspectStatus(getDb(), tenant, projectId, ids, status);
  refresh(projectId);
}
