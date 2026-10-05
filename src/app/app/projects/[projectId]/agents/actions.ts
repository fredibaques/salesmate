"use server";

import { revalidatePath } from "next/cache";
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
import {
  addAgent,
  getAgent,
  isProjectAgentType,
  removeAgent,
  saveAgentChannels,
  saveAgentProcess,
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
