import { requireAgent } from "../require-agent";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card } from "@/components/ui";
import { RunLog, RunSteps, usd } from "@/app/app/(settings)/runs/run-log";
import { getRun, listRuns, monthStart, runTotals } from "@/server/agents/runs";
import { agentTasks } from "@/server/agents/tasks";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/services/projects";
import { ResultsCard } from "../results-card";
import { PlannedTasks, RunningTasks } from "./task-list";

export const metadata = { title: "Tareas" };

/**
 * The agent's tasks: what it is doing now and how far along, what it will do
 * next, and below, every run it made with what it cost.
 */
export default async function AgentTasksPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]/tasks">) {
  const { projectId, agentId } = await params;
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const tenant = await requireTenant();
  const db = getDb();
  const filter = { projectId, agentId };
  const [{ agent }, project] = await Promise.all([
    requireAgent(projectId, agentId),
    getProject(db, tenant, projectId),
  ]);
  const [{ runs, next }, month, open, tasks] = await Promise.all([
    listRuns(db, tenant, { ...filter, before: one("before") ? new Date(one("before")!) : undefined }),
    runTotals(db, tenant, { ...filter, since: monthStart("Europe/Madrid") }),
    one("run") ? getRun(db, tenant, one("run")!) : null,
    agentTasks(db, tenant, {
      agentId,
      timezone: project?.timezone ?? "Europe/Madrid",
      projectPaused: Boolean(project?.agentsPaused),
    }),
  ]);
  const path = `/app/projects/${projectId}/agents/${agentId}/tasks`;
  const keep = one("before") ? `before=${encodeURIComponent(one("before")!)}&` : "";
  const stepsHref = (id: string) => `${path}?${keep}run=${id}`;
  // While it works, or a batch is about to start, the page follows it.
  const busy =
    tasks.running.length > 0 ||
    Boolean(one("working")) ||
    tasks.planned.some((t) => t.when === "en unos minutos");

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_20rem]">
      {busy ? <AutoRefresh seconds={8} /> : null}
      <div className="min-w-0 space-y-6">
        <Card
          title="En curso"
          tip="Lo que está haciendo ahora. Un encargo grande (p. ej. 120 filas nuevas) se hace por tandas: la barra cuenta lo hecho en todas."
        >
          <RunningTasks tasks={tasks.running} stepsHref={stepsHref} />
        </Card>
        <Card
          title="Planificadas"
          tip="Lo que hará después, en orden: las tandas que le quedan de un encargo, lo que le ha llegado y su próxima ronda programada."
        >
          <PlannedTasks tasks={tasks.planned} />
        </Card>
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Historial</h2>
          <RunLog
            runs={runs}
            showAgent={false}
            stepsHref={stepsHref}
            moreHref={next ? `${path}?before=${encodeURIComponent(next.toISOString())}` : null}
          />
        </section>
      </div>
      <div className="space-y-6">
        {agent.config.agentType === "prospecting" || agent.config.agentType === "outbound" ? (
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
