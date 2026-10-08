"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { scheduleFromForm } from "@/lib/schedule";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { PROSPECTING_MODES, SALES_MOTIONS, type ProspectingMode, type SalesMotion } from "@/server/db/schema";
import { bool, list, num, runForm, str } from "@/server/form";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { draftPlaybook } from "@/server/playbooks/draft";
import { AGENT_PROCESS_FIELDS, NEXT_STEPS, type NextStep, type PlaybookSpec } from "@/server/playbooks/spec";
import { DEFAULT_CELLS_PER_RUN, runProspecting } from "@/server/agents/prospector";
import { closeStaleRuns } from "@/server/agents/scheduler";
import { agentRunDeps } from "@/server/agents/runtime";
import { requireOrgLlm } from "@/server/llm/org-ai";
import { setAgentBase } from "@/server/prospects/bases";
import {
  addAgent,
  getAgent,
  isProjectAgentType,
  listAgentRuns,
  removeAgent,
  customizeAgent,
  rotateAgentHook,
  saveAgentAutomation,
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

function instructionsFromForm(form: FormData, scheduled: boolean) {
  return {
    instructions: str(form, "instructions") ?? "",
    schedule: scheduled ? scheduleFromForm(form) : null,
    settings: scheduled
      ? {
          prospectsPerRun: num(form, "prospectsPerRun") ?? 10,
          mode: PROSPECTING_MODES.find((m) => m === str(form, "mode")) ?? "both",
          cellsPerRun: num(form, "cellsPerRun") ?? DEFAULT_CELLS_PER_RUN,
          model: str(form, "model") ?? "",
        }
      : {},
  };
}

function toolsFromForm(form: FormData) {
  // Each checked MCP tool arrives as "<connectionId>::<tool name>".
  const byServer = new Map<string, string[]>();
  for (const value of list(form, "mcp")) {
    const [connectionId, ...rest] = value.split("::");
    const tool = rest.join("::");
    if (!connectionId || !tool) continue;
    byServer.set(connectionId, [...(byServer.get(connectionId) ?? []), tool]);
  }
  return {
    web: bool(form, "web"),
    mcp: [...byServer].map(([connectionId, tools]) => ({ connectionId, tools })),
    data: list(form, "data"),
  };
}

function channelsFromForm(form: FormData) {
  return {
    mailboxId: str(form, "mailboxId") ?? null,
    readMailbox: bool(form, "readMailbox"),
    calendarId: str(form, "calendarId") ?? null,
    crmConnectionId: str(form, "crmConnectionId") ?? null,
  };
}

/**
 * Adds an agent with the first configuration chosen in the setup wizard
 * and opens it. Everything can be changed later on the agent's page.
 */
export async function setupAgentAction(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  let added: ProjectAgentType | undefined;
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const kind = agentType(type);
    if (kind === "outbound") {
      await addAgent(db, tenant, projectId, kind, "b2b_consultative");
      await saveAgentInstructions(db, tenant, projectId, kind, instructionsFromForm(form, true));
      await saveAgentTools(db, tenant, projectId, kind, toolsFromForm(form));
    } else {
      const motion = salesMotion(form);
      const nextSteps = nextStepsFromForm(form);
      await addAgent(db, tenant, projectId, kind, motion);
      await saveAgentProcess(db, tenant, projectId, kind, {
        salesMotion: motion,
        process: {
          customerType: str(form, "customerType") === "b2c" ? "b2c" : "b2b",
          objective: str(form, "objective") ?? "",
          nextSteps,
        },
        notes: "Configuración inicial",
      });
      await saveAgentChannels(db, tenant, projectId, kind, channelsFromForm(form));
      await updateAgentAutonomy(db, tenant, projectId, kind, {
        defaultLevel: num(form, "defaultLevel") ?? 1,
      });
    }
    if (bool(form, "activate")) await setAgentEnabled(db, tenant, projectId, kind, true);
    added = kind;
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
  redirect(`/app/projects/${projectId}`);
}

export async function customizeAgentAction(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await customizeAgent(getDb(), tenant, projectId, agentType(type), {
      name: str(form, "name") ?? "",
      icon: str(form, "icon"),
      color: str(form, "color"),
    });
  }, "Agente guardado.");
  revalidatePath("/app", "layout");
  return result;
}

export async function toggleAgent(projectId: string, type: string, enabled: boolean) {
  const tenant = await admin();
  await setAgentEnabled(getDb(), tenant, projectId, agentType(type), enabled);
  refresh(projectId);
}

/** One main outcome, then the chosen alternatives in catalog order. */
function nextStepsFromForm(form: FormData): NextStep[] {
  const primary = str(form, "primaryStep") as NextStep | undefined;
  if (!primary || !NEXT_STEPS.includes(primary)) throw new Error("Elige cómo debe terminar la conversación.");
  const alternatives = NEXT_STEPS.filter((s) => s !== primary && list(form, "alternativeSteps").includes(s));
  return [primary, ...alternatives];
}

/** Reads the process form. */
function processFromForm(form: FormData): Partial<PlaybookSpec> {
  return {
    customerType: str(form, "customerType") === "b2c" ? "b2c" : "b2b",
    objective: str(form, "objective") ?? "",
    nextSteps: nextStepsFromForm(form),
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
    const { spec, gaps } = await draftPlaybook({ db, llm: await requireOrgLlm(db, tenant) }, tenant, {
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
    await saveAgentChannels(getDb(), tenant, projectId, agentType(type), channelsFromForm(form));
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
    const db = getDb();
    await saveAgentInstructions(db, tenant, projectId, kind, instructionsFromForm(form, scheduled));
    const baseId = str(form, "baseId");
    if (kind === "outbound" && baseId) {
      const agent = await getAgent(db, tenant, projectId, kind);
      if (agent && agent.config.prospectBaseId !== baseId) {
        await setAgentBase(db, tenant, projectId, agent.config.id, baseId);
      }
    }
  }, "Instrucciones guardadas.");
  refresh(projectId);
  return result;
}

/** Domains typed one per line or separated by commas. */
const domainList = (form: FormData, key: string) =>
  (str(form, key) ?? "")
    .split(/[\n,]+/)
    .map((d) => d.trim())
    .filter(Boolean);

/** Money typed with a comma or a point; empty = no cap. */
const amount = (form: FormData, key: string) => {
  const v = str(form, key);
  return v === undefined ? undefined : Number(v.replace(",", "."));
};

export async function saveAutomation(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const goalRows = num(form, "goalRows");
    const prefer = str(form, "sourcesPrefer");
    await saveAgentAutomation(getDb(), tenant, projectId, agentType(type), {
      triggers: { newRows: bool(form, "triggerNewRows"), webhook: bool(form, "triggerWebhook") },
      budget: {
        maxCostPerRunUsd: amount(form, "maxCostPerRunUsd"),
        maxCostPerMonthUsd: amount(form, "maxCostPerMonthUsd"),
        maxSearchesPerRun: num(form, "maxSearchesPerRun"),
      },
      goal: goalRows ? { rows: goalRows, minFit: num(form, "goalMinFit") } : null,
      sources: {
        allow: domainList(form, "sourcesAllow"),
        block: domainList(form, "sourcesBlock"),
        prefer: prefer === "data" || prefer === "web" ? prefer : null,
      },
      notify: {
        slackConnectionId: str(form, "slackConnectionId") ?? null,
        emails: list(form, "notifyEmails"),
        onFinish: bool(form, "notifyOnFinish"),
        onProblem: bool(form, "notifyOnProblem"),
      },
      mailboxId: str(form, "mailboxId") ?? null,
      handoff: {
        enabled: bool(form, "handoffEnabled"),
        minFit: num(form, "handoffMinFit"),
        perRun: num(form, "handoffPerRun"),
        instructions: str(form, "handoffInstructions"),
      },
    });
  }, "Automatización guardada.");
  refresh(projectId);
  return result;
}

export async function rotateHook(projectId: string, type: string, _: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await rotateAgentHook(getDb(), tenant, projectId, agentType(type));
  }, "Nueva dirección creada: la anterior ya no funciona.");
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
    await saveAgentTools(getDb(), tenant, projectId, agentType(type), toolsFromForm(form));
  }, "Herramientas guardadas.");
  refresh(projectId);
  return result;
}

/** Starts a run now in the background; what it finds appears as it is saved. */
async function startRun(projectId: string, options: { mode?: ProspectingMode; rowIds?: string[] }) {
  const tenant = await admin();
  const db = getDb();
  const llm = await requireOrgLlm(db, tenant);
  await closeStaleRuns(db, new Date());
  const [last] = await listAgentRuns(db, tenant, projectId, "outbound", 1);
  if (last?.status === "running")
    throw new Error("El agente ya está trabajando. Espera a que termine (unos minutos).");
  after(async () => {
    try {
      await runProspecting(agentRunDeps(llm), tenant, {
        projectId,
        trigger: "manual",
        triggerRef: tenant.userId,
        ...options,
      });
    } catch (err) {
      console.error("prospecting run failed", err);
    }
  });
}

/** «Buscar ahora»: a run in the agent's own mode. */
export async function runProspectingNow(projectId: string, _: FormState): Promise<FormState> {
  return runForm(async () => {
    await startRun(projectId, {});
    return "En marcha. Lo que encuentre irá apareciendo en unos minutos; recarga la página para verlo.";
  });
}

/** «Completar vacíos» (or one row's «Completar esta fila»): fills empty cells, without looking for new rows. */
export async function completeProspectsNow(
  projectId: string,
  rowIds: string[] | null,
  _: FormState,
): Promise<FormState> {
  return runForm(async () => {
    await startRun(projectId, { mode: "complete", rowIds: rowIds ?? undefined });
    return "En marcha. Los datos irán apareciendo en unos minutos; recarga la página para verlos.";
  });
}
