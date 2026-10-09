"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { requireRole, requireTenant } from "@/server/auth/session";
import { AGENT_TYPES, type AgentType } from "@/server/db/schema";
import { runForm, str } from "@/server/form";
import { decideAction, GatewayError, proposeAction } from "@/server/gateway/gateway";
import { gatewayDeps } from "@/server/gateway/runtime";

const OUTCOME_MESSAGES: Record<string, string> = {
  executed: "Aprobada y ejecutada.",
  failed: "Aprobada, pero la ejecución ha fallado. Revisa el detalle.",
  deferred: "Aprobada; se ejecutará en la próxima franja permitida.",
  blocked: "Bloqueada al revisar de nuevo las reglas.",
  approved: "Aprobada; se ejecutará cuando se reanuden los agentes.",
  rejected: "Rechazada.",
};

function editedPayload(type: string, original: Record<string, unknown>, form: FormData) {
  if (type === "email.send" || type === "email.create_draft") {
    const to = (str(form, "to") ?? "").split(/[,;\s]+/).filter(Boolean);
    return { ...original, to, subject: str(form, "subject") ?? "", body: String(form.get("body") ?? "") };
  }
  if (type === "whatsapp.send" && form.has("body")) {
    return { ...original, body: String(form.get("body") ?? "") };
  }
  const raw = str(form, "payload");
  if (!raw) return original;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("El contenido no es JSON válido.");
  }
}

export async function approve(
  actionId: string,
  type: string,
  original: Record<string, unknown>,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireTenant();
    const payload = editedPayload(type, original, form);
    const edited = JSON.stringify(payload) !== JSON.stringify(original);
    const outcome = await decideAction(gatewayDeps(), tenant, {
      actionId,
      decision: "approved",
      editedPayload: edited ? payload : undefined,
      reason: str(form, "reason"),
    });
    return OUTCOME_MESSAGES[outcome.outcome] ?? outcome.outcome;
  });
  revalidatePath("/app", "layout");
  return result;
}

export async function reject(actionId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireTenant();
    await decideAction(gatewayDeps(), tenant, {
      actionId,
      decision: "rejected",
      reason: str(form, "reason"),
    });
    return OUTCOME_MESSAGES.rejected;
  });
  revalidatePath("/app", "layout");
  return result;
}

/**
 * Lets you exercise the approval flow before agents exist: the action is
 * proposed as if an agent had prepared it.
 */
export async function simulateAgentProposal(_: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const agentType = (str(form, "agentType") ?? "outbound") as AgentType;
    if (!AGENT_TYPES.includes(agentType)) throw new Error("Agente desconocido.");
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(str(form, "payload") ?? "{}");
    } catch {
      throw new Error("El contenido no es JSON válido.");
    }
    try {
      const outcome = await proposeAction(
        gatewayDeps(),
        { orgId: tenant.orgId, actorType: "agent", actorId: `simulated:${tenant.userId}` },
        {
          projectId: str(form, "projectId") ?? "",
          type: str(form, "type") ?? "",
          agentType,
          payload,
          reason: "Propuesta simulada desde la bandeja",
          context: str(form, "customerType")
            ? { customerType: str(form, "customerType") as "b2b" | "b2c" }
            : {},
        },
      );
      return `Resultado: ${outcome.outcome}`;
    } catch (err) {
      if (err instanceof GatewayError && err.details) {
        throw new Error(`${err.message} ${JSON.stringify(err.details)}`);
      }
      throw err;
    }
  });
  revalidatePath("/app", "layout");
  return result;
}
