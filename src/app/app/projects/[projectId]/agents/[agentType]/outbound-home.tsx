import { notFound } from "next/navigation";
import { Card, LinkButton, Meta } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listProspects } from "@/server/prospects/service";
import { getAgent, listAgentRuns } from "@/server/services/agents";
import { InstructionsCard } from "./instructions-card";
import { RunStatus } from "./run-status";

/** Prospecting agent: what to look for and when, with its latest run alongside. */
export async function OutboundHome({ projectId }: { projectId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, runs, prospects] = await Promise.all([
    getAgent(db, tenant, projectId, "outbound"),
    listAgentRuns(db, tenant, projectId, "outbound", 1),
    listProspects(db, tenant, projectId, { limit: 1 }),
  ]);
  if (!agent) notFound();
  const last = runs[0];
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
      <InstructionsCard projectId={projectId} agentType="outbound" config={agent.config} />
      <Card
        title="Resultados"
        actions={
          <LinkButton href={`/app/projects/${projectId}/agents/outbound/prospects`} variant="ghost">
            Ver prospectos
          </LinkButton>
        }
      >
        <p className="text-3xl font-semibold tabular-nums">{prospects.total}</p>
        <p className="text-sm text-muted">
          prospectos en la base, {prospects.byStatus.new ?? 0} nuevos sin exportar
        </p>
        <div className="mt-4 border-t border-border pt-4 text-sm">
          {last ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Última ejecución</span>
                <RunStatus status={last.status} />
              </div>
              <p className="mt-1 text-xs text-muted">
                <Meta
                  items={[
                    formatDateTime(last.startedAt),
                    last.trigger === "schedule" ? "programada" : "manual",
                    last.costUsd ? `${Number(last.costUsd).toFixed(2)} $` : null,
                  ]}
                />
              </p>
              {last.summary || last.error ? (
                <p className="mt-2 text-sm whitespace-pre-wrap text-muted">{last.error ?? last.summary}</p>
              ) : null}
            </>
          ) : (
            <p className="text-muted">
              Todavía no ha trabajado. Actívalo o lánzalo a mano desde «Prospectos».
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
