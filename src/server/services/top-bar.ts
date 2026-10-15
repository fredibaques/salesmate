import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { agentName } from "@/lib/agents";
import { RUN_STALE_MS, runningTask, type AgentTask } from "../agents/tasks";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, connections, orgAi, userPreferences } from "../db/schema";
import { withTenant, type TenantContext } from "../db/tenant";
import { isProjectAgentType } from "./agents";

/**
 * What the bar across the top of every page shows: the agents working right
 * now (with their tasks' progress) and the notices that ask for attention.
 */

export type WorkingAgent = {
  id: string;
  projectId: string;
  agentType: string;
  label: string;
  icon: string | null;
  color: string | null;
  tasks: AgentTask[];
};

/** Agents of these projects with a run in progress, each with what it is doing. */
export async function workingAgents(
  db: Db,
  tenant: Pick<TenantContext, "orgId">,
  input: { projectIds: string[]; now?: Date },
): Promise<WorkingAgent[]> {
  if (!input.projectIds.length) return [];
  const now = input.now ?? new Date();
  const runs = await withTenant(db, tenant, (tx) =>
    tx
      .select({
        run: {
          id: agentRuns.id,
          trigger: agentRuns.trigger,
          task: agentRuns.task,
          startedAt: agentRuns.startedAt,
          costUsd: agentRuns.costUsd,
        },
        agent: {
          id: agentConfigs.id,
          projectId: agentConfigs.projectId,
          agentType: agentConfigs.agentType,
          name: agentConfigs.name,
          icon: agentConfigs.icon,
          color: agentConfigs.color,
          baseId: agentConfigs.prospectBaseId,
        },
      })
      .from(agentRuns)
      .innerJoin(agentConfigs, eq(agentConfigs.id, agentRuns.agentConfigId))
      .where(
        and(
          eq(agentRuns.status, "running"),
          gt(agentRuns.startedAt, new Date(now.getTime() - RUN_STALE_MS)),
          inArray(agentRuns.projectId, input.projectIds),
          isNotNull(agentConfigs.addedAt),
        ),
      )
      .orderBy(agentRuns.startedAt),
  );
  const byAgent = new Map<string, WorkingAgent>();
  for (const { run, agent } of runs) {
    if (!isProjectAgentType(agent.agentType)) continue;
    const task = await runningTask(db, tenant, run, agent.baseId);
    const entry = byAgent.get(agent.id) ?? {
      id: agent.id,
      projectId: agent.projectId,
      agentType: agent.agentType,
      label: agentName(agent.agentType, agent.name),
      icon: agent.icon,
      color: agent.color,
      tasks: [],
    };
    entry.tasks.push(task);
    byAgent.set(agent.id, entry);
  }
  return [...byAgent.values()];
}

export type AppNotice = {
  key: string;
  /** problem: something went wrong; attention: waits for someone; done: a run ended well. */
  tone: "problem" | "attention" | "done";
  title: string;
  detail?: string;
  href: string;
  /** When it happened; standing notices (pending approvals, a broken connection) have none. */
  at: Date | null;
  /** New since the person last opened the notices (standing ones always count). */
  unread: boolean;
};

/** How far back finished runs show up. */
const NOTICE_WINDOW_MS = 7 * 24 * 3600_000;
const MAX_RUN_NOTICES = 20;

/**
 * What asks for the person's attention: actions waiting for approval, a
 * connection or the organization's AI account failing, and how the agents'
 * recent runs went (the same notice the agent sends the team).
 */
export async function appNotices(
  db: Db,
  tenant: { orgId: string; userId: string },
  input: { projectIds: string[]; pendingApprovals: number; now?: Date },
): Promise<{ notices: AppNotice[]; unread: number }> {
  const now = input.now ?? new Date();
  const { seenAt, broken, ai, runs } = await withTenant(db, tenant, async (tx) => {
    const [prefs] = await tx
      .select({ seenAt: userPreferences.noticesSeenAt })
      .from(userPreferences)
      .where(and(eq(userPreferences.orgId, tenant.orgId), eq(userPreferences.userId, tenant.userId)));
    const broken = await tx
      .select({ id: connections.id, label: connections.label, lastError: connections.lastError })
      .from(connections)
      .where(eq(connections.status, "error"));
    const [ai] = await tx
      .select({ status: orgAi.status, lastError: orgAi.lastError, at: orgAi.lastErrorAt })
      .from(orgAi);
    const runs = input.projectIds.length
      ? await tx
          .select({
            id: agentRuns.id,
            status: agentRuns.status,
            notice: agentRuns.notice,
            error: agentRuns.error,
            at: sql<Date>`coalesce(${agentRuns.finishedAt}, ${agentRuns.startedAt})`.mapWith(
              agentRuns.startedAt,
            ),
            agentId: agentConfigs.id,
            projectId: agentConfigs.projectId,
            agentType: agentConfigs.agentType,
            name: agentConfigs.name,
          })
          .from(agentRuns)
          .innerJoin(agentConfigs, eq(agentConfigs.id, agentRuns.agentConfigId))
          .where(
            and(
              inArray(agentRuns.projectId, input.projectIds),
              or(isNotNull(agentRuns.notice), eq(agentRuns.status, "failed")),
              gt(agentRuns.startedAt, new Date(now.getTime() - NOTICE_WINDOW_MS)),
            ),
          )
          .orderBy(desc(agentRuns.startedAt))
          .limit(MAX_RUN_NOTICES)
      : [];
    return { seenAt: prefs?.seenAt ?? null, broken, ai, runs };
  });

  const notices: AppNotice[] = [];
  if (input.pendingApprovals > 0) {
    notices.push({
      key: "approvals",
      tone: "attention",
      title:
        input.pendingApprovals === 1
          ? "1 acción espera tu aprobación"
          : `${input.pendingApprovals} acciones esperan tu aprobación`,
      href: "/app/inbox",
      at: null,
      unread: true,
    });
  }
  if (ai?.status === "error") {
    notices.push({
      key: "ai",
      tone: "problem",
      title: "La cuenta de IA de la organización da error",
      detail: ai.lastError ?? undefined,
      href: "/app/ai",
      at: ai.at,
      unread: true,
    });
  }
  for (const c of broken) {
    notices.push({
      key: `connection:${c.id}`,
      tone: "problem",
      title: `Revisa la conexión «${c.label}»`,
      detail: c.lastError ?? undefined,
      href: "/app/connections",
      at: null,
      unread: true,
    });
  }
  for (const r of runs) {
    if (!isProjectAgentType(r.agentType)) continue;
    const notice = r.notice ?? {
      problem: true,
      headline: "La ejecución ha fallado",
      details: r.error ?? undefined,
    };
    notices.push({
      key: `run:${r.id}`,
      tone: notice.problem ? "problem" : "done",
      title: `${agentName(r.agentType, r.name)}: ${notice.headline}`,
      detail: notice.details,
      href: `/app/projects/${r.projectId}/agents/${r.agentId}`,
      at: r.at,
      unread: !seenAt || r.at.getTime() > seenAt.getTime(),
    });
  }
  return { notices, unread: notices.filter((n) => n.unread).length };
}

/** The person opened the notices: what is there now no longer counts as new. */
export async function markNoticesSeen(db: Db, tenant: { orgId: string; userId: string }, now = new Date()) {
  await withTenant(db, tenant, (tx) =>
    tx
      .insert(userPreferences)
      .values({ orgId: tenant.orgId, userId: tenant.userId, noticesSeenAt: now })
      .onConflictDoUpdate({
        target: [userPreferences.orgId, userPreferences.userId],
        set: { noticesSeenAt: now },
      }),
  );
}
