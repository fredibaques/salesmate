"use server";

import { revalidatePath } from "next/cache";
import { askCopilot, type CopilotTurn } from "@/server/agents/copilot";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { gatewayDeps } from "@/server/gateway/runtime";
import { requireOrgLlm } from "@/server/llm/org-ai";

export type CopilotReply = { ok: true; answer: string; actions: number } | { ok: false; error: string };

export async function ask(
  projectId: string,
  history: CopilotTurn[],
  question: string,
): Promise<CopilotReply> {
  const tenant = await requireTenant();
  if (!question.trim()) return { ok: false, error: "Escribe una pregunta." };
  try {
    const db = getDb();
    const result = await askCopilot(
      { db, llm: await requireOrgLlm(db, tenant), gateway: gatewayDeps() },
      { orgId: tenant.orgId, userId: tenant.userId },
      { projectId, history: history.slice(-12), question: question.slice(0, 4000) },
    );
    if (result.proposedActions.length) revalidatePath("/app", "layout");
    return { ok: true, answer: result.answer, actions: result.proposedActions.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
