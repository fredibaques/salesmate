import { format } from "date-fns";
import { es } from "date-fns/locale";
import { TZDate } from "@date-fns/tz";
import { Building2, ChevronRight, Database, User } from "lucide-react";
import { LineChart } from "@/components/line-chart";
import { SegmentedLinks } from "@/components/nav-link";
import { Card, EmptyState, RowLink } from "@/components/ui";
import { plural } from "@/lib/format";
import { costSeries, COST_BUCKETS, type CostBucket } from "@/server/agents/runs";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listAllBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { listProjectAgents } from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { NewTableButton } from "../../tables/new-table-button";
import { usd } from "../../(settings)/runs/run-log";
import { AddAgentButton, AgentCards } from "./agents/agent-cards";

const GROUPS: Record<CostBucket, { label: string; period: string }> = {
  day: { label: "Por día", period: "últimos 30 días" },
  week: { label: "Por semana", period: "últimas 12 semanas" },
  month: { label: "Por mes", period: "últimos 12 meses" },
};

/** The cost series as chart points, with dates in the project's time zone. */
function costPoints(series: Awaited<ReturnType<typeof costSeries>>, bucket: CostBucket, timeZone: string) {
  return series.map((b) => {
    const d = new TZDate(b.start.getTime(), timeZone);
    const short =
      bucket === "month" ? format(d, "MMM yy", { locale: es }) : format(d, "d MMM", { locale: es });
    return {
      label: short,
      title:
        bucket === "day"
          ? format(d, "EEEE d 'de' MMMM", { locale: es })
          : bucket === "week"
            ? `Semana del ${format(d, "d 'de' MMMM", { locale: es })}`
            : format(d, "MMMM yyyy", { locale: es }),
      value: b.costUsd,
      display: usd(b.costUsd),
      detail: b.runs === 1 ? "1 ejecución" : `${b.runs} ejecuciones`,
    };
  });
}

/**
 * The project's summary: what it costs and its tables on top, then its
 * agents (and a card to add one). Each agent also has its own entry under
 * the project in the sidebar.
 */
export default async function ProjectOverviewPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]">) {
  const { projectId } = await params;
  const q = await searchParams;
  const bucket = COST_BUCKETS.find((b) => b === q.coste) ?? "day";
  const agentParam = typeof q.agente === "string" ? q.agente : undefined;
  const tenant = await requireTenant();
  const db = getDb();
  const project = await getProject(db, tenant, projectId);
  const timeZone = project?.timezone ?? "Europe/Madrid";
  const [agents, series, bases] = await Promise.all([
    listProjectAgents(db, tenant, projectId),
    costSeries(db, tenant, { projectId, bucket, timeZone }),
    listAllBases(db, tenant, { projectId }),
  ]);
  // Cells left to fill, only where an agent fills the table.
  const pendingCells = await Promise.all(
    bases.map((b) => (b.agents.length ? countPendingCells(db, tenant, b.id) : Promise.resolve(0))),
  );
  const periodCost = series.reduce((sum, b) => sum + b.costUsd, 0);
  const base = `/app/projects/${projectId}`;
  const canEdit = tenant.role !== "member";

  return (
    <div className="space-y-6">
      {/* Cost (¾) and tables (¼), the same height. */}
      <div className="grid gap-6 lg:grid-cols-4">
        <Card
          className="lg:col-span-3"
          title={`Coste: ${usd(periodCost)}`}
          tip={`Lo que han costado las ejecuciones de los agentes de este proyecto en los ${GROUPS[bucket].period}, según los precios de tu proveedor de IA. El desglose de cada ejecución está en Configuración → Ejecuciones.`}
          actions={
            <SegmentedLinks
              label="Agrupar el coste"
              options={COST_BUCKETS.map((b) => ({
                href: b === "day" ? base : `${base}?coste=${b}`,
                label: GROUPS[b].label,
                active: b === bucket,
              }))}
            />
          }
        >
          <LineChart
            points={costPoints(series, bucket, timeZone)}
            label={`Coste del proyecto ${GROUPS[bucket].label.toLowerCase()}, ${GROUPS[bucket].period}`}
            unit="usd"
          />
        </Card>

        <section id="tablas" className="scroll-mt-6">
          <Card
            className="flex h-full flex-col"
            title="Tablas"
            actions={
              canEdit && bases.length ? (
                <NewTableButton projectId={projectId} variant="ghost" size="sm" iconOnly />
              ) : null
            }
          >
            {bases.length ? (
              <ul className="-my-1 divide-y divide-border">
                {bases.map((b, i) => (
                  <li key={b.id}>
                    <RowLink href={`/app/tables/${b.id}`} className="flex-nowrap py-2.5">
                      <span className="flex min-w-0 items-center gap-2">
                        {b.rowKind === "person" ? (
                          <User className="size-4 shrink-0 text-muted" aria-hidden />
                        ) : (
                          <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{b.name}</span>
                          <span className="block truncate text-xs text-muted">
                            {plural(b.rows, "fila", "filas")}
                            {pendingCells[i] ? ` · ${pendingCells[i]} por completar` : ""}
                          </span>
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-muted" />
                    </RowLink>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon={<Database />}
                title="Sin tablas"
                description="Empresas o personas con las columnas que tú decides."
                action={canEdit ? <NewTableButton projectId={projectId} variant="secondary" /> : null}
              />
            )}
          </Card>
        </section>
      </div>

      <section id="agentes" className="scroll-mt-6">
        <AgentCards
          projectId={projectId}
          agents={agents}
          addCard={
            canEdit ? <AddAgentButton projectId={projectId} agents={agents} open={agentParam} card /> : null
          }
        />
      </section>
    </div>
  );
}
