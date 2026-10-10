import { requireAgent } from "../require-agent";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card } from "@/components/ui";
import { RunLog, RunSteps, usd } from "@/app/app/(settings)/runs/run-log";
import { getRun, listRuns, monthStart, runTotals } from "@/server/agents/runs";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { ResultsCard } from "../results-card";

export const metadata = { title: "Log" };

/** What the agent did, run by run, with what each run cost. */
export default async function AgentLogPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/log">) {
  const { projectId, agentId } = await params;
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const tenant = await requireTenant();
  const db = getDb();
  const filter = { projectId, agentId };
  const { agent } = await requireAgent(projectId, agentId);
  const [{ runs, next }, month, open] = await Promise.all([
    listRuns(db, tenant, { ...filter, before: one("before") ? new Date(one("before")!) : undefined }),
    runTotals(db, tenant, { ...filter, since: monthStart("Europe/Madrid") }),
    one("run") ? getRun(db, tenant, one("run")!) : null,
  ]);
  const path = `/app/projects/${projectId}/agents/${agentId}/log`;
  const keep = one("before") ? `before=${encodeURIComponent(one("before")!)}&` : "";
  const working = runs[0]?.status === "running" || Boolean(one("working"));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
      {working ? <AutoRefresh seconds={8} /> : null}
      <div className="min-w-0 space-y-3">
        <RunLog
          runs={runs}
          showAgent={false}
          stepsHref={(id) => `${path}?${keep}run=${id}`}
          moreHref={next ? `${path}?before=${encodeURIComponent(next.toISOString())}` : null}
        />
      </div>
      <div className="space-y-6">
        {agent.config.agentType === "outbound" ? (
          <ResultsCard projectId={projectId} agentId={agentId} />
        ) : null}
        <Card
          title="Este mes"
          tip="Lo que han costado sus ejecuciones según los precios de tu proveedor de IA."
        >
          <p className="text-3xl font-semibold tabular-nums">{usd(month.costUsd)}</p>
          <p className="text-sm text-muted">
            {month.runs === 1 ? "1 ejecución" : `${month.runs} ejecuciones`}
          </p>
        </Card>
      </div>
      {open ? (
        <RunSteps
          run={open}
          closeHref={one("before") ? `${path}?before=${encodeURIComponent(one("before")!)}` : path}
        />
      ) : null}
    </div>
  );
}
