import { Download, ExternalLink, Search, Undo2, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import {
  Badge,
  Button,
  buttonClass,
  Card,
  cx,
  EmptyState,
  Notice,
  Table,
  Td,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { PROSPECT_STATUSES } from "@/server/db/schema";
import { isLlmConfigured } from "@/server/llm/client";
import { listProspects, normalizeDomain, type ProspectStatus } from "@/server/prospects/service";
import { getAgent, listAgentRuns } from "@/server/services/agents";
import { changeProspects, runProspectingNow } from "../../actions";

// «Buscar ahora» keeps running after the response.
export const maxDuration = 300;

const STATUS: Record<ProspectStatus, { label: string; tone: "accent" | "success" | "neutral" | "warning" }> =
  {
    new: { label: "Sin revisar", tone: "accent" },
    accepted: { label: "Aceptado", tone: "success" },
    exported: { label: "Exportado", tone: "neutral" },
    discarded: { label: "Descartado", tone: "warning" },
  };

/** A run cut off by the platform stays "running"; after 10 minutes it isn't really searching. */
function isRecent(startedAt: Date) {
  return Date.now() - new Date(startedAt).getTime() < 10 * 60_000;
}

function RunNowButton({ projectId }: { projectId: string }) {
  return (
    <ActionForm
      action={runProspectingNow.bind(null, projectId)}
      submitLabel="Buscar ahora"
      submitVariant="secondary"
      className="flex flex-wrap items-center gap-3"
    />
  );
}

export default async function ProspectsPage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]/prospects">) {
  const { projectId, agentType } = await params;
  if (agentType !== "outbound") notFound();
  const query = await searchParams;
  const status = PROSPECT_STATUSES.find((s) => s === query.status);
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, data, runs] = await Promise.all([
    getAgent(db, tenant, projectId, "outbound"),
    listProspects(db, tenant, projectId, { status, limit: 300 }),
    listAgentRuns(db, tenant, projectId, "outbound", 1),
  ]);
  if (!agent) notFound();
  const base = `/app/projects/${projectId}/agents/outbound/prospects`;
  const exportUrl = `/app/projects/${projectId}/prospects/export`;
  const running = runs[0]?.status === "running" && isRecent(runs[0].startedAt);
  const pendingExport = (data.byStatus.new ?? 0) + (data.byStatus.accepted ?? 0);

  return (
    <div className="space-y-6">
      {!isLlmConfigured() ? (
        <Notice tone="warning">
          La IA no está configurada todavía (falta ANTHROPIC_API_KEY): el agente no puede buscar.
        </Notice>
      ) : running ? (
        <Notice>Está buscando ahora mismo. Recarga la página en unos minutos para ver lo nuevo.</Notice>
      ) : null}

      <Card
        title="Prospectos"
        description="Empresas que ha encontrado el agente, con los datos públicos y las páginas de donde salen. Revisa, descarta las que no te sirvan y exporta el resto."
        actions={
          data.total > 0 ? (
            <>
              <RunNowButton projectId={projectId} />
              <a
                href={`${exportUrl}?include=pending`}
                className={buttonClass({ variant: pendingExport > 0 ? "primary" : "secondary" })}
              >
                <Download className="size-4" />
                Exportar nuevos ({pendingExport})
              </a>
            </>
          ) : null
        }
      >
        {data.total === 0 ? (
          <EmptyState
            icon={<Search />}
            title="Todavía no hay prospectos"
            description={
              agent.config.enabled
                ? "El agente buscará en su próxima hora programada. También puedes lanzarlo ahora."
                : "Activa el agente para que busque cada día a su hora, o lánzalo ahora para probar."
            }
            action={<RunNowButton projectId={projectId} />}
          />
        ) : (
          <>
            <nav className="mb-4 flex flex-wrap gap-1 text-sm">
              {[undefined, ...PROSPECT_STATUSES].map((s) => {
                const active = s === status;
                const n = s ? (data.byStatus[s] ?? 0) : data.total;
                return (
                  <Link
                    key={s ?? "all"}
                    href={s ? `${base}?status=${s}` : base}
                    className={cx(
                      "rounded-lg px-3 py-1.5 transition-colors",
                      active
                        ? "bg-accent/10 font-medium text-accent"
                        : "text-muted hover:bg-background hover:text-foreground",
                    )}
                  >
                    {s ? STATUS[s].label : "Todos"} <span className="tabular-nums">{n}</span>
                  </Link>
                );
              })}
              <a
                href={exportUrl}
                className="ml-auto rounded-lg px-3 py-1.5 text-muted transition-colors hover:bg-background hover:text-foreground"
              >
                Exportar todo
              </a>
            </nav>
            {data.rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No hay prospectos en este estado.</p>
            ) : (
              <Table head={["Empresa", "Dónde", "Contacto", "Encaje", "Estado", ""]}>
                {data.rows.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-background">
                    <Td>
                      <div className="font-medium">{p.companyName}</div>
                      {p.website ? (
                        <a
                          href={p.website.startsWith("http") ? p.website : `https://${p.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          {normalizeDomain(p.website) ?? p.website}
                          <ExternalLink className="size-3" />
                        </a>
                      ) : null}
                      {p.sector ? <div className="text-xs text-muted">{p.sector}</div> : null}
                    </Td>
                    <Td className="text-xs">
                      {[p.city, p.region, p.country].filter(Boolean).join(", ") || "—"}
                    </Td>
                    <Td className="text-xs">
                      {p.contactName ? (
                        <div>
                          {p.contactName}
                          {p.contactRole ? <span className="text-muted"> · {p.contactRole}</span> : null}
                        </div>
                      ) : null}
                      {p.email ? (
                        <a href={`mailto:${p.email}`} className="block text-accent hover:underline">
                          {p.email}
                        </a>
                      ) : null}
                      {p.phone ? <div>{p.phone}</div> : null}
                      {!p.contactName && !p.email && !p.phone ? <span className="text-muted">—</span> : null}
                    </Td>
                    <Td className="max-w-sm text-xs">
                      {p.fitScore != null ? (
                        <Badge tone={p.fitScore >= 70 ? "success" : p.fitScore >= 40 ? "accent" : "neutral"}>
                          {p.fitScore}
                        </Badge>
                      ) : null}
                      {p.fitReason ? <p className="mt-1 text-muted">{p.fitReason}</p> : null}
                      {p.sources.length ? (
                        <p className="mt-1 flex flex-wrap gap-2">
                          {p.sources.map((src, i) => (
                            <a
                              key={src}
                              href={src}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                              title={src}
                            >
                              Fuente {i + 1}
                            </a>
                          ))}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                      <div className="mt-1 text-muted">{formatDate(p.createdAt)}</div>
                    </Td>
                    <Td>
                      <form
                        action={changeProspects.bind(
                          null,
                          projectId,
                          [p.id],
                          p.status === "discarded" ? "new" : "discarded",
                        )}
                      >
                        {p.status === "discarded" ? (
                          <Button variant="ghost" size="sm" iconOnly aria-label={`Recuperar ${p.companyName}`} title="Recuperar">
                            <Undo2 className="size-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="dangerGhost"
                            aria-label={`Descartar ${p.companyName}`}
                            title="Descartar"
                          >
                            <X className="size-4" />
                          </Button>
                        )}
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
