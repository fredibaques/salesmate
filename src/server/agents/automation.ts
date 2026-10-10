import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { agentName } from "@/lib/agents";
import type { Db } from "../db/client";
import { agentConfigs, agentRuns, member, prospects, user, type AgentSettings } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import { env } from "../env";
import { GatewayError, proposeAction, type GatewayDeps } from "../gateway/gateway";

/**
 * What surrounds a run: the month's spending cap, the goal that stops the
 * search for new rows, and the notices to the team when a run ends. Notices
 * are gateway actions (notify.slack / notify.email) like any other effect.
 */

/** USD the agent has spent this calendar month, in the project's time zone. */
export async function monthSpendUsd(
  db: Db,
  tenant: { orgId: string },
  input: { agentId: string; timezone: string },
): Promise<number> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({ total: sql<string>`coalesce(sum(${agentRuns.costUsd}), 0)` })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.agentConfigId, input.agentId),
          sql`date_trunc('month', ${agentRuns.startedAt} at time zone ${input.timezone}) = date_trunc('month', now() at time zone ${input.timezone})`,
        ),
      ),
  );
  return Number(row?.total ?? 0);
}

/** Rows of the base that count for the goal (fit at least minFit, not discarded). */
export async function goalProgress(
  db: Db,
  tenant: { orgId: string },
  baseId: string,
  goal: NonNullable<AgentSettings["goal"]>,
): Promise<{ rows: number; target: number; met: boolean; remaining: number }> {
  const [row] = await withTenant(db, tenant, (tx) =>
    tx
      .select({ n: sql<number>`count(*)` })
      .from(prospects)
      .where(
        and(
          eq(prospects.baseId, baseId),
          ne(prospects.status, "discarded"),
          goal.minFit ? gte(prospects.fitScore, goal.minFit) : undefined,
        ),
      ),
  );
  const rows = Number(row?.n ?? 0);
  return { rows, target: goal.rows, met: rows >= goal.rows, remaining: Math.max(0, goal.rows - rows) };
}

/** Stops the agent from working on its own (the goal was reached). */
export async function pauseAgent(db: Db, tenant: { orgId: string }, agentConfigId: string, note: string) {
  await withTenant(db, tenant, (tx) =>
    tx
      .update(agentConfigs)
      .set({ enabled: false, scheduleNote: note })
      .where(eq(agentConfigs.id, agentConfigId)),
  );
}

/** Emails of the organization's members among `emails` (notices never leave the team). */
export async function teamEmails(db: Db, orgId: string, emails: string[]): Promise<string[]> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return [];
  const rows = await withSystem(db, (tx) =>
    tx
      .select({ email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(member.organizationId, orgId), inArray(sql`lower(${user.email})`, wanted))),
  );
  return rows.map((r) => r.email.toLowerCase());
}

export type RunNotice = {
  /** A problem (failed, nothing found, a cap reached) or just the end of a run. */
  problem: boolean;
  /** One line: what happened. */
  headline: string;
  /** The run's summary. */
  details?: string;
};

/**
 * Tells the team how a run went, where the agent says so: Slack and/or
 * email from its mailbox to members of the organization. Each notice goes
 * through the gateway; a failure to notify never fails the run.
 */
export async function notifyTeam(
  deps: { db: Db; gateway: GatewayDeps },
  tenant: { orgId: string },
  input: {
    agent: {
      id: string;
      name: string | null;
      projectId: string;
      settings: AgentSettings;
      channels: { mailboxId?: string | null };
    };
    projectName: string;
    runId: string;
    notice: RunNotice;
  },
): Promise<{ sent: string[]; errors: string[] }> {
  const notify = input.agent.settings.notify;
  const sent: string[] = [];
  const errors: string[] = [];
  if (!notify) return { sent, errors };
  const wanted = input.notice.problem ? notify.onProblem : notify.onFinish;
  if (!wanted) return { sent, errors };

  const name = agentName("outbound", input.agent.name);
  const link = `${env().APP_URL}/app/projects/${input.agent.projectId}/agents/${input.agent.id}`;
  const actor = { orgId: tenant.orgId, actorType: "agent" as const, actorId: input.runId };
  const base = {
    projectId: input.agent.projectId,
    agentType: "outbound" as const,
    agentConfigId: input.agent.id,
    runId: input.runId,
    reason: "Aviso al equipo configurado en el agente",
  };
  const propose = async (channel: string, type: string, payload: Record<string, unknown>) => {
    try {
      const result = await proposeAction(deps.gateway, actor, { ...base, type, payload });
      if (result.outcome === "executed" || result.outcome === "duplicate") sent.push(channel);
      else errors.push(`${channel}: ${result.action.error ?? result.outcome}`);
    } catch (err) {
      errors.push(
        `${channel}: ${err instanceof GatewayError || err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const icon = input.notice.problem ? "⚠️" : "✅";
  if (notify.slackConnectionId) {
    await propose("Slack", "notify.slack", {
      connectionId: notify.slackConnectionId,
      text: [
        `${icon} *${name}* · ${input.projectName}: ${input.notice.headline}`,
        input.notice.details ? input.notice.details.slice(0, 1500) : null,
        `<${link}|Abrir el agente>`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
  const to = notify.emails?.length ? await teamEmails(deps.db, tenant.orgId, notify.emails) : [];
  if (to.length && input.agent.channels.mailboxId) {
    await propose("email", "notify.email", {
      identityId: input.agent.channels.mailboxId,
      to,
      subject: `${name} · ${input.notice.headline}`.slice(0, 300),
      body: [
        `${input.projectName} · ${name}`,
        "",
        input.notice.headline,
        input.notice.details ? `\n${input.notice.details}` : "",
        "",
        `Abrir el agente: ${link}`,
      ].join("\n"),
    });
  }
  return { sent, errors };
}
