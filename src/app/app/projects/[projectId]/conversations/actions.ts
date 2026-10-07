"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { processInboundEvent, processPendingInbound } from "@/server/agents/inbound";
import { inboundDeps } from "@/server/agents/runtime";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { requireOrgLlm } from "@/server/llm/org-ai";
import { queueTestLead, rotateFormKey } from "@/server/services/sales";

const admin = () => requireRole(["owner", "admin"]);

export async function rotateKey(projectId: string) {
  const tenant = await admin();
  await rotateFormKey(getDb(), tenant, projectId);
  revalidatePath(`/app/projects/${projectId}`, "layout");
}

export async function simulateLead(projectId: string, _: FormState, form: FormData): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const llm = await requireOrgLlm(getDb(), tenant);
    const fields = Object.fromEntries(
      ["nombre", "email", "telefono", "empresa", "mensaje"].flatMap((k) => {
        const v = str(form, k);
        return v ? [[k, v]] : [];
      }),
    );
    const event = await queueTestLead(getDb(), tenant, projectId, fields);
    const outcome = await processInboundEvent(inboundDeps(llm), tenant.orgId, event.id);
    if (outcome.status === "processed") return `Procesado. ${outcome.summary}`;
    if (outcome.status === "ignored") return `Ignorado: ${outcome.reason}`;
    if (outcome.status === "error") throw new Error(outcome.error);
    return "Ya estaba en proceso.";
  });
  revalidatePath(`/app/projects/${projectId}`, "layout");
  revalidatePath("/app", "layout");
  return result;
}

export async function processNow(projectId: string, _: FormState): Promise<FormState> {
  const result = await runForm(async () => {
    const tenant = await admin();
    const llm = await requireOrgLlm(getDb(), tenant);
    const outcomes = await processPendingInbound(inboundDeps(llm), tenant.orgId, 10);
    return outcomes.length
      ? `Procesados: ${outcomes.map((o) => o.status).join(", ")}`
      : "No había nada pendiente.";
  });
  revalidatePath(`/app/projects/${projectId}`, "layout");
  return result;
}
