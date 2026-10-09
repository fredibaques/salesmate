import { format } from "date-fns";
import { es } from "date-fns/locale";
import { TZDate } from "@date-fns/tz";
import { Bot, CheckCircle2, ChevronRight, Circle, Database } from "lucide-react";
import Link from "next/link";
import { LineChart } from "@/components/line-chart";
import { SegmentedLinks } from "@/components/nav-link";
import { Badge, Card, EmptyState, Toolbar } from "@/components/ui";
import { costSeries, COST_BUCKETS, type CostBucket } from "@/server/agents/runs";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listAllBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { getSalesProfile, listProjectAgents } from "@/server/services/agents";
import { getProject, listKnowledge } from "@/server/services/projects";
import { NewTableButton } from "../../tables/new-table-button";
import { TablesList } from "../../tables/tables-list";
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
 * The project's summary: what is left to set it up and its agents. Each
 * agent also has its own entry under the project in the sidebar.
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
  const [profile, sources, agents, series, bases] = await Promise.all([
    getSalesProfile(db, tenant, projectId),
    listKnowledge(db, tenant, projectId),
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
  const firstAgent = agents[0]?.config.agentType;
  const steps = [
    {
      done: Boolean(profile.offer || profile.valueProposition || profile.segment.include.length),
      label: "Describe tu oferta y tu cliente ideal",
      hint: "Lo comparten todos los agentes del proyecto.",
      href: `${base}/sales`,
    },
    {
      done: sources.length > 0,
      label: "Sube tu conocimiento",
      hint: "Tarifas, condiciones, presentaciones… para que respondan con datos reales.",
      href: `${base}/knowledge`,
    },
    {
      done: agents.length > 0,
      label: "Añade un agente",
      hint: "Por ejemplo, el inbound para atender a quien te contacta.",
      href: `${base}#agentes`,
    },
    {
      // Only agents that write to people need a mailbox.
      done:
        agents.length > 0 &&
        agents.every((a) => a.config.agentType === "outbound" || a.config.channels.mailboxId),
      label: "Dile con qué cuentas y herramientas trabaja",
      hint: "Usa las cuentas que tu organización ya ha conectado.",
      href: firstAgent ? `${base}/agents/${firstAgent}/channels` : `${base}#agentes`,
    },
    {
      done: agents.some((a) => a.config.enabled),
      label: "Actívalo",
      hint: "Hasta entonces, los contactos se guardan pero nadie los atiende.",
      href: firstAgent ? `${base}/agents/${firstAgent}` : `${base}#agentes`,
    },
  ];
  const pending = steps.filter((x) => !x.done).length;
  const canEdit = tenant.role !== "member";

  return (
    <div className="space-y-6">
      {canEdit && agents.length > 0 ? (
        <Toolbar>
          <AddAgentButton projectId={projectId} agents={agents} open={agentParam} />
        </Toolbar>
      ) : null}
      {pending > 0 ? (
        <Card
          title="Puesta en marcha"
          actions={<Badge tone="accent">{pending === 1 ? "Queda 1 paso" : `Quedan ${pending} pasos`}</Badge>}
        >
          <ol className="grid gap-x-6 gap-y-1 md:grid-cols-2">
            {steps.map((step, i) => (
              <li key={step.label}>
                <Link
                  href={step.href}
                  className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-background"
                >
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted" />
                  )}
                  <span className="flex-1">
                    <span className={step.done ? "text-sm text-muted line-through" : "text-sm font-medium"}>
                      {i + 1}. {step.label}
                    </span>
                    {!step.done ? <span className="block text-xs text-muted">{step.hint}</span> : null}
                  </span>
                  <ChevronRight className="mt-0.5 size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <section id="agentes" className="scroll-mt-6">
        {agents.length > 0 ? (
          <AgentCards projectId={projectId} agents={agents} />
        ) : (
          <EmptyState
            icon={<Bot />}
            title="Este proyecto todavía no tiene agentes"
            description="Añade uno para que atienda a quien te contacta o busque clientes nuevos. Después lo encontrarás bajo el proyecto, en el menú de la izquierda."
            action={
              canEdit ? <AddAgentButton projectId={projectId} agents={agents} open={agentParam} /> : null
            }
          />
        )}
      </section>

      <Card
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

      <section id="tablas" className="scroll-mt-6 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Tablas</h2>
          {canEdit && bases.length ? <NewTableButton projectId={projectId} variant="secondary" /> : null}
        </div>
        {bases.length ? (
          <TablesList bases={bases} pending={pendingCells} showProject={false} />
        ) : (
          <EmptyState
            compact
            icon={<Database />}
            title="Todavía no hay tablas"
            description="Una tabla de empresas o personas con las columnas que tú decides. La rellenan los agentes del proyecto, tu equipo o el formulario de tu web."
            action={canEdit ? <NewTableButton projectId={projectId} variant="primary" /> : null}
          />
        )}
      </section>
    </div>
  );
}
