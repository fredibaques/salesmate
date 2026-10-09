"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { scheduleFromForm } from "@/lib/schedule";
import { requireRole } from "@/server/auth/session";
import { requireOrgLlm } from "@/server/llm/org-ai";
import { getDb } from "@/server/db/client";
import { PROSPECTING_MODES, SALES_MOTIONS, type ProspectingMode } from "@/server/db/schema";
import { bool, list, num, runForm, str } from "@/server/form";
import { ACTION_DEFINITIONS } from "@/server/gateway/definitions";
import { DEFAULT_CELLS_PER_RUN, runProspecting } from "@/server/agents/prospector";
import { closeStaleRuns } from "@/server/agents/scheduler";
import { agentRunDeps } from "@/server/agents/runtime";
import { setAgentBase } from "@/server/prospects/bases";
import {
  addAgent,
  addAgentTool,
  getAgent,
  isProjectAgentType,
  listAgentRuns,
  removeAgent,
  removeAgentTool,
  customizeAgent,
  rotateAgentHook,
  saveAgentAutomation,
  saveAgentChannels,
  saveAgentInstructions,
  saveAgentTools,
  setAgentEnabled,
  setAgentMcpTools,
  type AgentToolKey,
  updateAgentAutonomy,
  type ProjectAgentType,
} from "@/server/services/agents";

const admin = () => requireRole(["owner", "admin"]);
const refresh = (projectId: string) => revalidatePath(`/app/projects/${projectId}`, "layout");

function agentType(value: string): ProjectAgentType {
  if (!isProjectAgentType(value)) throw new Error("Agente desconocido.");
  return value;
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
    whatsappId: str(form, "whatsappId") ?? null,
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
      // Gives the project a process from this template only if it has none yet.
      await addAgent(
        db,
        tenant,
        projectId,
        kind,
        SALES_MOTIONS.find((m) => m === str(form, "salesMotion")),
      );
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

/** The automation fields of an agent's form (triggers, goal, caps, sources, notices, first contact). */
function automationFromForm(form: FormData): Parameters<typeof saveAgentAutomation>[4] {
  const goalRows = num(form, "goalRows");
  const prefer = str(form, "sourcesPrefer");
  return {
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
      prefer: prefer === "data" || prefer === "web" ? (prefer as "data" | "web") : null,
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
  };
}

/**
 * The prospecting agent's whole setup in one form: its goal and
 * instructions, when and how much it works, its model, sources and caps,
 * whom it tells and the next step.
 */
export async function saveAgentSetup(
  projectId: string,
  type: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const kind = agentType(type);
    const db = getDb();
    await saveAgentInstructions(db, tenant, projectId, kind, instructionsFromForm(form, true));
    await saveAgentAutomation(db, tenant, projectId, kind, automationFromForm(form));
    const baseId = str(form, "baseId");
    if (kind === "outbound" && baseId) {
      const agent = await getAgent(db, tenant, projectId, kind);
      if (agent && agent.config.prospectBaseId !== baseId) {
        await setAgentBase(db, tenant, projectId, agent.config.id, baseId);
      }
    }
  }, "Configuración guardada.");
  refresh(projectId);
  return result;
}

/**
 * The inbound agent's whole setup in one form: what it does and on which
 * table, where it listens, its model and the accounts it writes from.
 */
export async function saveInboundSetup(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    await saveAgentInstructions(db, tenant, projectId, "inbound", {
      instructions: str(form, "instructions") ?? "",
      schedule: null,
      settings: { model: str(form, "model") ?? "" },
    });
    await saveAgentChannels(db, tenant, projectId, "inbound", channelsFromForm(form));
    const agent = await getAgent(db, tenant, projectId, "inbound");
    const baseId = str(form, "baseId") ?? null;
    if (agent && agent.config.prospectBaseId !== baseId) {
      await setAgentBase(db, tenant, projectId, agent.config.id, baseId);
    }
  }, "Configuración guardada.");
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

/** «Añadir» in the available tools: the agent can use it from now on. */
export async function addToolAction(
  projectId: string,
  type: string,
  key: AgentToolKey,
  label: string,
  _: FormState,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await addAgentTool(getDb(), tenant, projectId, agentType(type), key);
    return `${label}: añadida.`;
  });
  refresh(projectId);
  return result;
}

export async function removeToolAction(
  projectId: string,
  type: string,
  key: AgentToolKey,
  label: string,
  _: FormState,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await removeAgentTool(getDb(), tenant, projectId, agentType(type), key);
    return `${label}: quitada.`;
  });
  refresh(projectId);
  return result;
}

/** The functions of an MCP server the agent may call. */
export async function saveMcpToolsAction(
  projectId: string,
  type: string,
  connectionId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await setAgentMcpTools(getDb(), tenant, projectId, agentType(type), connectionId, list(form, "tool"));
  }, "Funciones guardadas.");
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

/**
 * Where to go once a run is started: back to the page it was started from
 * (a form field `back`, a path under /app), marked so it watches the run.
 */
function backTo(form: FormData | undefined) {
  const back = form ? str(form, "back") : undefined;
  if (!back?.startsWith("/app/")) return null;
  const url = new URL(back, "http://x");
  url.searchParams.set("working", String(Date.now()));
  return `${url.pathname}${url.search}`;
}

/** «Buscar ahora»: a run in the agent's own mode. */
export async function runProspectingNow(
  projectId: string,
  _: FormState,
  form?: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    await startRun(projectId, {});
    return "En marcha. Lo que encuentre irá apareciendo en unos minutos.";
  });
  const back = result?.ok ? backTo(form) : null;
  if (back) redirect(back);
  return result;
}

/** «Completar vacíos» (or one row's «Completar esta fila»): fills empty cells, without looking for new rows. */
export async function completeProspectsNow(
  projectId: string,
  rowIds: string[] | null,
  _: FormState,
  form?: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    await startRun(projectId, { mode: "complete", rowIds: rowIds ?? undefined });
    return "En marcha. Los datos irán apareciendo en la tabla en unos minutos.";
  });
  const back = result?.ok ? backTo(form) : null;
  if (back) redirect(back);
  return result;
}
