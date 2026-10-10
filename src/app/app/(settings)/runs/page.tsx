import { AgentTile } from "@/components/agent-look-fields";
import { Card } from "@/components/ui";
import { SubmitOnChange } from "@/app/app/conversations/inbox-client";
import { getRun, listRuns, monthStart, runTotals } from "@/server/agents/runs";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { AGENT_TYPES, type AgentType } from "@/server/db/schema";
import { listProjects } from "@/server/services/projects";
import { RunLog, RunSteps, usd } from "./run-log";

export const metadata = { title: "Ejecuciones" };

const TZ = "Europe/Madrid";
const PERIODS = [
  { value: "month", label: "Este mes" },
  { value: "last", label: "El mes pasado" },
  { value: "90d", label: "Últimos 90 días" },
];
const AGENTS: { value: AgentType; label: string }[] = [
  { value: "outbound", label: "Prospección" },
  { value: "inbound", label: "Inbound" },
  { value: "account_manager", label: "Cuentas" },
  { value: "copilot", label: "Copilot" },
];

function period(key: string) {
  if (key === "last") return { since: monthStart(TZ, -1), until: monthStart(TZ) };
  if (key === "90d") return { since: new Date(Date.now() - 90 * 86_400_000), until: undefined };
  return { since: monthStart(TZ), until: undefined };
}

/**
 * Every run of every agent of the organization, with what each one cost
 * item by item, and the spending of the period by agent.
 */
export default async function RunsPage({ searchParams }: PageProps<"/app/runs">) {
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  const tenant = await requireTenant();
  const db = getDb();
  const periodKey = PERIODS.some((p) => p.value === one("period")) ? one("period")! : "month";
  const { since, until } = period(periodKey);
  const projects = await listProjects(db, tenant);
  const projectId = projects.some((p) => p.id === one("project")) ? one("project") : undefined;
  const agentType = AGENT_TYPES.find((a) => a === one("agent"));
  const before = one("before") ? new Date(one("before")!) : until;
  const filter = { projectId, agentType, since };
  const [{ runs, next }, totals, open] = await Promise.all([
    listRuns(db, tenant, { ...filter, before }),
    runTotals(db, tenant, { ...filter, until }),
    one("run") ? getRun(db, tenant, one("run")!) : null,
  ]);

  const href = (changes: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const next = {
      period: periodKey === "month" ? undefined : periodKey,
      project: projectId,
      agent: agentType,
      before: one("before"),
      run: undefined,
      ...changes,
    };
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/app/runs?${s}` : "/app/runs";
  };

  return (
    <div className="space-y-6">
      <form action="/app/runs" className="flex flex-wrap items-center gap-2">
        <SubmitOnChange name="period" defaultValue={periodKey} aria-label="Periodo" options={PERIODS} />
        <SubmitOnChange
          name="project"
          defaultValue={projectId ?? ""}
          aria-label="Proyecto"
          wide
          options={[
            { value: "", label: "Todos los proyectos" },
            ...projects.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <SubmitOnChange
          name="agent"
          defaultValue={agentType ?? ""}
          aria-label="Agente"
          wide
          options={[{ value: "", label: "Todos los agentes" }, ...AGENTS]}
        />
      </form>

      <Card
        title={`${PERIODS.find((p) => p.value === periodKey)!.label}: ${usd(totals.costUsd)}`}
        tip="Lo que han costado las ejecuciones de los agentes según los precios de tu proveedor de IA (tokens y búsquedas web). No incluye lo que cobran aparte otras herramientas, como los créditos de Apollo o Hunter."
      >
        {totals.byAgent.length ? (
          <ul className="space-y-2.5">
            {totals.byAgent.map((a) => {
              const share = totals.costUsd ? a.costUsd / totals.costUsd : 0;
              return (
                <li
                  key={`${a.projectId}:${a.agentId ?? a.agentType}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <AgentTile type={a.agentType} icon={a.icon} color={a.color} size="sm" />
                  <span className="min-w-0 flex-1 sm:w-48 sm:flex-none sm:shrink-0">
                    <span className="block truncate font-medium">{a.label}</span>
                    <span className="block truncate text-xs text-muted">{a.projectName}</span>
                  </span>
                  <span className="hidden h-2 flex-1 overflow-hidden rounded-full bg-ink-100 sm:block">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(2, share * 100)}%` }}
                    />
                  </span>
                  <span className="hidden w-24 text-right text-xs text-muted tabular-nums sm:block">
                    {a.runs === 1 ? "1 ejecución" : `${a.runs} ejecuciones`}
                  </span>
                  <span className="w-20 text-right font-medium whitespace-nowrap tabular-nums">
                    {usd(a.costUsd)}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Sin ejecuciones en este periodo.</p>
        )}
      </Card>

      <RunLog
        runs={runs}
        showAgent
        stepsHref={(id) => href({ run: id })}
        moreHref={next ? href({ before: next.toISOString() }) : null}
      />

      {open ? <RunSteps run={open} closeHref={href({})} /> : null}
    </div>
  );
}
