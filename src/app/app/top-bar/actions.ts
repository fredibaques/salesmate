"use server";

import { revalidatePath } from "next/cache";
import { askCopilot, type CopilotTurn } from "@/server/agents/copilot";
import { pageContext } from "@/server/agents/page-context";
import {
  listVisibleProjects,
  projectAccess,
  requireProjectAccess,
  requireTenant,
} from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { gatewayDeps } from "@/server/gateway/runtime";
import { requireOrgLlm } from "@/server/llm/org-ai";
import { canSee } from "@/server/services/access";
import { appNotices, markNoticesSeen, workingAgents } from "@/server/services/top-bar";

/** What the top bar shows: the agents working now and the notices. */
export async function topBarState() {
  const tenant = await requireTenant();
  const db = getDb();
  const projects = await listVisibleProjects();
  const projectIds = projects.map((p) => p.id);
  const pendingApprovals = projects.reduce((n, p) => n + p.pendingApprovals, 0);
  const [working, notices] = await Promise.all([
    workingAgents(db, tenant, { projectIds }),
    appNotices(db, tenant, { projectIds, pendingApprovals }),
  ]);
  return { working, ...notices, now: new Date() };
}
export type TopBarState = Awaited<ReturnType<typeof topBarState>>;

/** The person opened the notices. */
export async function noticesSeen() {
  await markNoticesSeen(getDb(), await requireTenant());
}

/** What the page at `pathname` is, for the Copilot panel: its label and project. */
export async function copilotPage(pathname: string) {
  const tenant = await requireTenant();
  const visible = await projectAccess();
  const page = await pageContext(getDb(), tenant, pathname, (id) => canSee(visible, id));
  return page ? { label: page.label, projectId: page.projectId } : null;
}

export type PanelReply = { ok: true; answer: string; actions: number } | { ok: false; error: string };

/** A question to the Copilot from any page: it knows what is on screen. */
export async function askFromPage(
  projectId: string,
  pathname: string,
  history: CopilotTurn[],
  question: string,
): Promise<PanelReply> {
  const tenant = await requireProjectAccess(projectId).catch(() => null);
  if (!tenant) return { ok: false, error: "No tienes acceso a este proyecto." };
  if (!question.trim()) return { ok: false, error: "Escribe una pregunta." };
  try {
    const db = getDb();
    const visible = await projectAccess();
    const page = await pageContext(db, tenant, pathname, (id) => canSee(visible, id));
    const result = await askCopilot(
      { db, llm: await requireOrgLlm(db, tenant), gateway: gatewayDeps() },
      { orgId: tenant.orgId, userId: tenant.userId },
      {
        projectId,
        history: history.slice(-12),
        question: question.slice(0, 4000),
        page: page?.text,
      },
    );
    if (result.proposedActions.length) revalidatePath("/app", "layout");
    return { ok: true, answer: result.answer, actions: result.proposedActions.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
