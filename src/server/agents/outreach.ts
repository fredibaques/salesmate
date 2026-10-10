import { and, eq, isNotNull } from "drizzle-orm";
import { audit } from "../audit";
import { agentRuns, agentConfigs, projects, prospectBases } from "../db/schema";
import { withTenant } from "../db/tenant";
import { withModel } from "../llm/client";
import { projectProcess } from "../playbooks/service";
import { parseSalesProfile, renderPlaybook, renderSalesProfile } from "../playbooks/spec";
import { monthSpendUsd, notifyTeam, type RunNotice } from "./automation";
import { prepareFirstContacts } from "./first-contact";
import type { AgentRunDeps } from "./prospector";

export type OutreachResult = {
  runId: string;
  status: "completed" | "failed" | "skipped";
  /** First emails proposed in this run. */
  proposed: number;
  summary: string;
  costUsd: number;
};

/**
 * One run of an outbound agent: it starts the sale with the rows of its
 * table that fit (fit at least its minimum, with an email, not contacted
 * yet), writing each a first email in the project's voice and following
 * its sales process. Every email is proposed through the gateway: with the
 * default autonomy it waits in «Por aprobar». Replies land in the
 * conversation each email opens.
 */
export async function runOutreach(
  deps: AgentRunDeps,
  tenant: { orgId: string },
  input: { agentId: string; trigger: "schedule" | "manual" | "event"; triggerRef?: string },
): Promise<OutreachResult> {
  const { project, agent, base, process, run } = await withTenant(deps.db, tenant, async (tx) => {
    const [agent] = await tx
      .select()
      .from(agentConfigs)
      .where(
        and(
          eq(agentConfigs.id, input.agentId),
          eq(agentConfigs.agentType, "outbound"),
          isNotNull(agentConfigs.addedAt),
        ),
      );
    if (!agent) throw new Error("Agente outbound no encontrado.");
    const [project] = await tx.select().from(projects).where(eq(projects.id, agent.projectId));
    if (!project) throw new Error("Proyecto no encontrado.");
    const [base] = agent.prospectBaseId
      ? await tx.select().from(prospectBases).where(eq(prospectBases.id, agent.prospectBaseId))
      : [];
    const process = await projectProcess(tx, project.id);
    const [run] = await tx
      .insert(agentRuns)
      .values({
        orgId: tenant.orgId,
        projectId: project.id,
        agentType: "outbound",
        agentConfigId: agent.id,
        trigger: input.trigger,
        triggerRef: input.triggerRef,
        playbookVersionId: process?.versionId ?? null,
        model: withModel(deps.llm, agent.settings.model).model,
      })
      .returning();
    await audit(
      tx,
      { orgId: tenant.orgId, actorType: "agent", actorId: run.id },
      {
        event: "agent.run_started",
        projectId: project.id,
        entityType: "agent_run",
        entityId: run.id,
        data: { agentType: "outbound", trigger: input.trigger },
      },
    );
    return { project, agent, base: base ?? null, process, run };
  });

  const finish = (values: Partial<typeof agentRuns.$inferInsert>) =>
    withTenant(deps.db, tenant, (tx) =>
      tx
        .update(agentRuns)
        .set({ ...values, finishedAt: new Date() })
        .where(eq(agentRuns.id, run.id)),
    );
  const tell = async (notice: RunNotice) => {
    try {
      await notifyTeam({ db: deps.db, gateway: deps.gateway }, tenant, {
        agent,
        projectName: project.name,
        runId: run.id,
        notice,
      });
    } catch (err) {
      console.error("notify failed", err);
    }
  };
  const skip = async (summary: string) => {
    await finish({ status: "completed", summary, costUsd: 0 });
    await tell({ problem: true, headline: "No ha escrito a nadie", details: summary });
    return { runId: run.id, status: "skipped" as const, proposed: 0, summary, costUsd: 0 };
  };

  try {
    if (!base) return await skip("No ha trabajado: elige en su configuración la tabla con la que trabaja.");
    const monthCap = agent.settings.budget?.maxCostPerMonthUsd;
    if (monthCap !== undefined) {
      const spent = await monthSpendUsd(deps.db, tenant, { agentId: agent.id, timezone: project.timezone });
      if (spent >= monthCap)
        return await skip(
          `No ha trabajado: este mes ya ha gastado ${spent.toFixed(2)} $ de los ${monthCap.toFixed(2)} $ del límite.`,
        );
    }
    const profile = parseSalesProfile(project.salesProfile);
    const result = await prepareFirstContacts(
      { db: deps.db, llm: withModel(deps.llm, agent.settings.model), gateway: deps.gateway },
      tenant,
      {
        projectId: project.id,
        agentId: agent.id,
        projectName: project.name,
        profile: renderSalesProfile(profile),
        process: process
          ? renderPlaybook({ name: process.name, motion: process.salesMotion, spec: process.spec, profile })
          : undefined,
        runId: run.id,
        base,
        mailboxId: agent.channels.mailboxId,
        handoff: {
          ...agent.settings.handoff,
          enabled: true,
          // Its instructions say how to write; the old per-step ones are a fallback.
          instructions: agent.instructions || agent.settings.handoff?.instructions,
        },
      },
    );
    if (result.skipped) {
      await finish({
        status: "completed",
        summary: `No ha escrito a nadie: ${result.skipped}`,
        costUsd: result.costUsd,
      });
      await tell({ problem: true, headline: "No ha escrito a nadie", details: result.skipped });
      return {
        runId: run.id,
        status: "skipped",
        proposed: 0,
        summary: result.skipped,
        costUsd: result.costUsd,
      };
    }
    const summary = [
      result.proposed
        ? `${result.proposed === 1 ? "1 primer email preparado" : `${result.proposed} primeros emails preparados`}, esperando aprobación en «Por aprobar».`
        : `Ninguna fila de «${base.name}» nueva con email y el encaje mínimo: nadie a quien escribir esta vez.`,
      result.blocked.length ? `No enviados por las reglas del proyecto: ${result.blocked.join("; ")}.` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    await finish({ status: "completed", summary, costUsd: result.costUsd });
    await tell(
      result.proposed
        ? { problem: false, headline: `Ha preparado ${result.proposed} primeros emails`, details: summary }
        : { problem: true, headline: "No ha encontrado a quién escribir", details: summary },
    );
    return {
      runId: run.id,
      status: "completed",
      proposed: result.proposed,
      summary,
      costUsd: result.costUsd,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: message });
    await tell({ problem: true, headline: "La ejecución ha fallado", details: message });
    return { runId: run.id, status: "failed", proposed: 0, summary: message, costUsd: 0 };
  }
}
