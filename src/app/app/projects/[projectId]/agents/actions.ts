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
import { DEFAULT_HANDOFF_MIN_FIT, DEFAULT_HANDOFF_PER_RUN } from "@/server/agents/first-contact";
import { runInboundSweep } from "@/server/agents/inbound-sweep";
import { runOutreach } from "@/server/agents/outreach";
import { agentRunDeps, inboundDeps } from "@/server/agents/runtime";
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
  saveAgentOutreach,
  saveAgentTools,
  saveAgentTriggers,
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
  let added: string | undefined;
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const kind = agentType(type);
    // Gives the project a process from this template only if it has none yet.
    const agent = await addAgent(
      db,
      tenant,
      projectId,
      kind,
      SALES_MOTIONS.find((m) => m === str(form, "salesMotion")),
    );
    const name = str(form, "name");
    if (name) await customizeAgent(db, tenant, projectId, agent.id, { name });
    if (kind === "prospecting") {
      await saveAgentInstructions(db, tenant, projectId, agent.id, instructionsFromForm(form, true));
      await saveAgentTools(db, tenant, projectId, agent.id, toolsFromForm(form));
    } else if (kind === "outbound") {
      await outreachFromForm(db, tenant, projectId, agent.id, form);
    } else {
      await saveAgentChannels(db, tenant, projectId, agent.id, channelsFromForm(form));
      await updateAgentAutonomy(db, tenant, projectId, agent.id, {
        defaultLevel: num(form, "defaultLevel") ?? 1,
      });
    }
    if (bool(form, "activate")) await setAgentEnabled(db, tenant, projectId, agent.id, true);
    added = agent.id;
  });
  if (added) {
    refresh(projectId);
    redirect(`/app/projects/${projectId}/agents/${added}`);
  }
  return result;
}

export async function removeAgentAction(projectId: string, agentId: string) {
  const tenant = await admin();
  await removeAgent(getDb(), tenant, projectId, agentId);
  refresh(projectId);
  redirect(`/app/projects/${projectId}`);
}

export async function customizeAgentAction(
  projectId: string,
  agentId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await customizeAgent(getDb(), tenant, projectId, agentId, {
      name: str(form, "name") ?? "",
      icon: str(form, "icon"),
      color: str(form, "color"),
    });
  }, "Agente guardado.");
  revalidatePath("/app", "layout");
  return result;
}

export async function toggleAgent(projectId: string, agentId: string, enabled: boolean) {
  const tenant = await admin();
  await setAgentEnabled(getDb(), tenant, projectId, agentId, enabled);
  refresh(projectId);
}

export async function saveAutonomy(
  projectId: string,
  agentId: string,
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
    await updateAgentAutonomy(getDb(), tenant, projectId, agentId, {
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
  agentId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    await saveAgentInstructions(db, tenant, projectId, agentId, instructionsFromForm(form, true));
    await saveAgentAutomation(db, tenant, projectId, agentId, automationFromForm(form));
    const baseId = str(form, "baseId");
    if (baseId) {
      const agent = await getAgent(db, tenant, projectId, agentId);
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
export async function saveInboundSetup(
  projectId: string,
  agentId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    await saveAgentInstructions(db, tenant, projectId, agentId, {
      instructions: str(form, "instructions") ?? "",
      schedule: scheduleFromForm(form),
      settings: { model: str(form, "model") ?? "" },
    });
    await saveAgentTriggers(db, tenant, projectId, agentId, {
      form: bool(form, "triggerForm"),
      newRows: bool(form, "triggerNewRows"),
      webhook: bool(form, "triggerWebhook"),
    });
    // WhatsApp is listened to only while its event is on.
    await saveAgentChannels(db, tenant, projectId, agentId, {
      ...channelsFromForm(form),
      whatsappId: bool(form, "triggerWhatsapp") ? (str(form, "whatsappId") ?? null) : null,
    });
    const agent = await getAgent(db, tenant, projectId, agentId);
    const baseId = str(form, "baseId") ?? null;
    if (agent && agent.config.prospectBaseId !== baseId) {
      await setAgentBase(db, tenant, projectId, agent.config.id, baseId);
    }
  }, "Configuración guardada.");
  refresh(projectId);
  return result;
}

/** The outbound agent's fields, from its setup form or its wizard. */
async function outreachFromForm(
  db: ReturnType<typeof getDb>,
  tenant: Awaited<ReturnType<typeof admin>>,
  projectId: string,
  agentId: string,
  form: FormData,
) {
  await saveAgentInstructions(db, tenant, projectId, agentId, {
    instructions: str(form, "instructions") ?? "",
    schedule: scheduleFromForm(form),
    settings: { model: str(form, "model") ?? "" },
  });
  await saveAgentTriggers(db, tenant, projectId, agentId, {
    newRows: bool(form, "triggerNewRows"),
    webhook: bool(form, "triggerWebhook"),
  });
  await saveAgentOutreach(db, tenant, projectId, agentId, {
    minFit: num(form, "minFit") ?? DEFAULT_HANDOFF_MIN_FIT,
    perRun: num(form, "perRun") ?? DEFAULT_HANDOFF_PER_RUN,
    mailboxId: str(form, "mailboxId") ?? null,
  });
  const agent = await getAgent(db, tenant, projectId, agentId);
  const baseId = str(form, "baseId") ?? null;
  if (agent && agent.config.prospectBaseId !== baseId) {
    await setAgentBase(db, tenant, projectId, agentId, baseId);
  }
}

/**
 * The outbound agent's whole setup in one form: the table it works with
 * and how it writes, whom it writes to, when, its model and its mailbox.
 */
export async function saveOutreachSetup(
  projectId: string,
  agentId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    await outreachFromForm(getDb(), await admin(), projectId, agentId, form);
  }, "Configuración guardada.");
  refresh(projectId);
  return result;
}

/**
 * «Ejecutar ahora» of the outbound agent: prepares the first emails of the
 * rows that fit, after answering. They wait in «Por aprobar».
 */
export async function runOutreachNow(
  projectId: string,
  agentId: string,
  _: FormState,
  form?: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const agent = await getAgent(db, tenant, projectId, agentId);
    if (agent?.config.agentType !== "outbound") throw new Error("Agente no encontrado.");
    const llm = await requireOrgLlm(db, tenant);
    after(async () => {
      try {
        await runOutreach(agentRunDeps(llm), tenant, {
          agentId,
          trigger: "manual",
          triggerRef: tenant.userId,
        });
      } catch (err) {
        console.error("outreach run failed", err);
      }
    });
    return "En marcha: los primeros emails aparecerán en «Por aprobar» en unos minutos.";
  });
  refresh(projectId);
  const back = result?.ok ? backTo(form) : null;
  if (back) redirect(back);
  return result;
}

export async function rotateHook(projectId: string, agentId: string, _: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await rotateAgentHook(getDb(), tenant, projectId, agentId);
  }, "Nueva dirección creada: la anterior ya no funciona.");
  refresh(projectId);
  return result;
}

/** «Añadir» in the available tools: the agent can use it from now on. */
export async function addToolAction(
  projectId: string,
  agentId: string,
  key: AgentToolKey,
  label: string,
  _: FormState,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await addAgentTool(getDb(), tenant, projectId, agentId, key);
    return `${label}: añadida.`;
  });
  refresh(projectId);
  return result;
}

export async function removeToolAction(
  projectId: string,
  agentId: string,
  key: AgentToolKey,
  label: string,
  _: FormState,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await removeAgentTool(getDb(), tenant, projectId, agentId, key);
    return `${label}: quitada.`;
  });
  refresh(projectId);
  return result;
}

/** The functions of an MCP server the agent may call. */
export async function saveMcpToolsAction(
  projectId: string,
  agentId: string,
  connectionId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    await setAgentMcpTools(getDb(), tenant, projectId, agentId, connectionId, list(form, "tool"));
  }, "Funciones guardadas.");
  refresh(projectId);
  return result;
}

/** Starts a run of a prospecting agent now in the background; what it finds appears as it is saved. */
async function startRun(
  projectId: string,
  agentId: string,
  options: { mode?: ProspectingMode; rowIds?: string[]; allPending?: boolean },
) {
  const tenant = await admin();
  const db = getDb();
  const agent = await getAgent(db, tenant, projectId, agentId);
  if (agent?.config.agentType !== "prospecting") throw new Error("Agente no encontrado.");
  const llm = await requireOrgLlm(db, tenant);
  await closeStaleRuns(db, new Date());
  const [last] = await listAgentRuns(db, tenant, projectId, agentId, 1);
  if (last?.status === "running")
    throw new Error("El agente ya está trabajando. Espera a que termine (unos minutos).");
  after(async () => {
    try {
      await runProspecting(agentRunDeps(llm), tenant, {
        agentId,
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

/**
 * «Ejecutar ahora» of the inbound agent: reads its mailbox and attends
 * what is waiting, after answering. Its runs show in its Log.
 */
export async function runInboundNow(
  projectId: string,
  agentId: string,
  _: FormState,
  form?: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const db = getDb();
    const agent = await getAgent(db, tenant, projectId, agentId);
    if (agent?.config.agentType !== "inbound") throw new Error("Agente no encontrado.");
    const llm = await requireOrgLlm(db, tenant);
    after(async () => {
      try {
        await runInboundSweep(inboundDeps(llm), tenant, agentId);
      } catch (err) {
        console.error("inbound run failed", err);
      }
    });
    return "En marcha: revisa su buzón y atiende lo que tenga pendiente.";
  });
  refresh(projectId);
  const back = result?.ok ? backTo(form) : null;
  if (back) redirect(back);
  return result;
}

/** «Buscar ahora»: a run in the agent's own mode. */
export async function runProspectingNow(
  projectId: string,
  agentId: string,
  _: FormState,
  form?: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    await startRun(projectId, agentId, {});
    return "En marcha. Lo que encuentre irá apareciendo en unos minutos.";
  });
  const back = result?.ok ? backTo(form) : null;
  if (back) redirect(back);
  return result;
}

/** «Completar vacíos» (or one row's «Completar esta fila»): fills empty cells, without looking for new rows. */
export async function completeProspectsNow(
  projectId: string,
  agentId: string,
  rowIds: string[] | null,
  _: FormState,
  form?: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    // One row's «Completar esta fila», or every empty cell of the table (by batches).
    await startRun(projectId, agentId, rowIds ? { mode: "complete", rowIds } : { allPending: true });
    return rowIds
      ? "En marcha. Los datos irán apareciendo en la tabla en unos minutos."
      : "En marcha: completa toda la tabla por tandas. Los datos irán apareciendo según los encuentra.";
  });
  const back = result?.ok ? backTo(form) : null;
  if (back) redirect(back);
  return result;
}
