import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Plus,
  Search,
  Undo2,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { DataGrid, GridCell, GridHead, GridRow } from "@/components/data-grid";
import {
  Badge,
  Button,
  buttonClass,
  cx,
  EmptyState,
  Input,
  LinkButton,
  Notice,
  PageHeader,
} from "@/components/ui";
import { plural } from "@/lib/format";
import { isPendingCell } from "@/lib/prospect-columns";
import { PROSPECT_STATUSES } from "@/server/db/schema";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getBase, listBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { getProspect, listProspects, type ProspectStatus } from "@/server/prospects/service";
import { listAgentRuns } from "@/server/services/agents";
import { AiNotice } from "../../../../ai-notice";
import { completeProspectsNow, runProspectingNow } from "../../agents/actions";
import { changeProspectStatus } from "../actions";
import { CellState, cellTitle, COLUMN_ICONS, NotFound, Pending, ScoreBar, WebLink } from "../cells";
import { AddColumnButton, BaseSettings, ColumnsEditor, EditColumnButton } from "./columns-editor";
import { RowPanel } from "./row-panel";

// «Buscar ahora» keeps running after the response.
export const maxDuration = 300;

const PAGE_SIZE = 100;

const STATUS: Record<ProspectStatus, { label: string; tone: "accent" | "neutral" | "warning" }> = {
  new: { label: "Nuevo", tone: "accent" },
  accepted: { label: "Nuevo", tone: "accent" },
  exported: { label: "Exportado", tone: "neutral" },
  discarded: { label: "Descartado", tone: "warning" },
};

const FILTERS: { key?: ProspectStatus; label: string }[] = [
  { label: "Todos" },
  { key: "new", label: "Nuevos" },
  { key: "exported", label: "Exportados" },
  { key: "discarded", label: "Descartados" },
];

/** A run cut off by the platform stays "running"; after 10 minutes it isn't really searching. */
function isRecent(startedAt: Date) {
  return Date.now() - new Date(startedAt).getTime() < 10 * 60_000;
}

export default async function ProspectBasePage({
  params,
  searchParams,
}: PageProps<"/app/projects/[projectId]/prospects/[baseId]">) {
  const { projectId, baseId } = await params;
  const query = await searchParams;
  const tenant = await requireTenant();
  const db = getDb();
  const base = await getBase(db, tenant, baseId);
  if (!base || base.projectId !== projectId) notFound();

  const status = PROSPECT_STATUSES.find((s) => s === query.status);
  const q = typeof query.q === "string" ? query.q : "";
  const sort = typeof query.sort === "string" ? query.sort : undefined;
  const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const rowParam = typeof query.row === "string" ? query.row : undefined;
  const canEdit = tenant.role !== "member";
  const [data, bases, runs, openRow, pendingCells] = await Promise.all([
    listProspects(db, tenant, baseId, {
      status,
      q,
      sort,
      dir,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    listBases(db, tenant, projectId),
    listAgentRuns(db, tenant, projectId, "outbound", 1),
    rowParam && rowParam !== "new" ? getProspect(db, tenant, baseId, rowParam).catch(() => null) : null,
    countPendingCells(db, tenant, baseId),
  ]);
  const agents = bases.find((b) => b.id === baseId)?.agents ?? [];
  const filledByAgent = agents.includes("outbound");
  const running = filledByAgent && runs[0]?.status === "running" && isRecent(runs[0].startedAt);
  const columns = base.columns.filter((c) => !c.hidden);
  const person = base.rowKind === "person";
  const path = `/app/projects/${projectId}/prospects/${baseId}`;
  const href = (changes: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const next = { status, q: q || undefined, sort, dir, page, ...changes };
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || (k === "page" && Number(v) === 1)) continue;
      params.set(k, String(v));
    }
    const s = params.toString();
    return s ? `${path}?${s}` : path;
  };
  const sortLink = (key: string, label: React.ReactNode, align: "start" | "end" = "start") => {
    const active = sort === key;
    const nextDir = active && (dir ?? "asc") === "asc" ? "desc" : "asc";
    return (
      <Link
        href={href({ sort: key, dir: nextDir, page: undefined })}
        className={cx(
          "inline-flex items-center gap-1.5 hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted",
          align === "end" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? (dir ?? "asc") === "asc" ? <ArrowUp /> : <ArrowDown /> : null}
      </Link>
    );
  };
  const pendingExport = (data.byStatus.new ?? 0) + (data.byStatus.accepted ?? 0);
  const pages = Math.max(1, Math.ceil(data.matching / PAGE_SIZE));
  const exportUrl = `${path}/export`;
  const ids = { projectId, baseId };
  const addRow = (
    <Link
      href={href({ row: "new" })}
      scroll={false}
      className={buttonClass({ variant: "ghost", size: "sm" })}
    >
      <Plus />
      Añadir fila
    </Link>
  );

  return (
    <>
      <PageHeader
        icon={person ? <User /> : <Building2 />}
        title={base.name}
        tip={`Cada fila es ${person ? "una persona" : "una empresa"}. ${filledByAgent ? "La rellena el agente de prospección y la revisáis las personas del equipo." : "Ningún agente la rellena todavía."} Exportar descarga un Excel (CSV) con sus columnas y marca los nuevos como exportados.`}
        actions={
          <>
            {filledByAgent && canEdit && pendingCells > 0 ? (
              <ActionForm
                action={completeProspectsNow.bind(null, projectId, null)}
                submitLabel={`Completar vacíos (${pendingCells})`}
                submitVariant="secondary"
                className="flex flex-wrap items-center gap-3"
              />
            ) : null}
            {filledByAgent && canEdit ? (
              <ActionForm
                action={runProspectingNow.bind(null, projectId)}
                submitLabel="Buscar ahora"
                submitVariant="secondary"
                className="flex flex-wrap items-center gap-3"
              />
            ) : null}
            {data.total > 0 ? (
              <a
                href={`${exportUrl}?include=pending`}
                className={buttonClass({ variant: pendingExport > 0 ? "primary" : "secondary" })}
              >
                <Download />
                Exportar nuevos ({pendingExport})
              </a>
            ) : null}
            {canEdit ? (
              <BaseSettings {...ids} name={base.name} rows={data.total} agents={agents.length} />
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        {filledByAgent ? <AiNotice feature="La búsqueda de prospectos" /> : null}
        {running ? (
          <Notice>Está buscando ahora mismo. Recarga la página en unos minutos para ver lo nuevo.</Notice>
        ) : null}

        {data.total === 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-end gap-1">
              {canEdit ? <ColumnsEditor {...ids} columns={base.columns} person={person} /> : null}
              {addRow}
            </div>
            <EmptyState
              icon={<Search />}
              title="Todavía no hay filas"
              description={
                filledByAgent
                  ? "El agente de prospección las irá guardando aquí en cada ejecución. También puedes lanzarlo ahora con «Buscar ahora» o añadirlas a mano."
                  : "Añádelas a mano, o asigna esta base al agente de prospección desde su ficha para que la rellene."
              }
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <form action={path} className="w-full max-w-64">
                {status ? <input type="hidden" name="status" value={status} /> : null}
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Buscar por nombre"
                  icon={<Search />}
                  size="sm"
                  aria-label="Buscar por nombre"
                />
              </form>
              <nav className="flex flex-wrap gap-1" aria-label="Filtrar por estado">
                {FILTERS.map((f) => {
                  const n = f.key
                    ? (data.byStatus[f.key] ?? 0) + (f.key === "new" ? (data.byStatus.accepted ?? 0) : 0)
                    : data.total;
                  const active = f.key === status;
                  return (
                    <Link
                      key={f.label}
                      href={href({ status: f.key, page: undefined })}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        active
                          ? "border-border-strong bg-ink-100 font-medium text-foreground"
                          : "border-border text-ink-700 hover:bg-ink-50",
                      )}
                    >
                      {f.label} <span className="tabular-nums">{n}</span>
                    </Link>
                  );
                })}
              </nav>
              <span className="ml-auto flex flex-wrap items-center gap-1">
                {canEdit ? <ColumnsEditor {...ids} columns={base.columns} person={person} /> : null}
                {addRow}
                <a href={exportUrl} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  <Download />
                  Exportar todo
                </a>
              </span>
            </div>

            {data.rows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">Nada coincide con este filtro.</p>
            ) : (
              <DataGrid
                head={
                  <>
                    {person ? <GridHead sticky>{sortLink("person", "Nombre")}</GridHead> : null}
                    <GridHead sticky={!person}>{sortLink("name", "Empresa")}</GridHead>
                    <GridHead>{sortLink("web", "Web")}</GridHead>
                    <GridHead>{sortLink("fit", "Encaje")}</GridHead>
                    <GridHead>{sortLink("status", "Estado")}</GridHead>
                    {columns.map((c) => {
                      const Icon = COLUMN_ICONS[c.type];
                      const end = c.type === "number";
                      return (
                        <GridHead key={c.id} align={end ? "end" : "start"}>
                          <span className={cx("inline-flex items-center gap-1", end && "flex-row-reverse")}>
                            {sortLink(
                              c.id,
                              <>
                                <Icon />
                                {c.name}
                              </>,
                              end ? "end" : "start",
                            )}
                            {canEdit ? (
                              <EditColumnButton
                                {...ids}
                                column={c}
                                className="-my-1 opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
                              />
                            ) : null}
                          </span>
                        </GridHead>
                      );
                    })}
                    <GridHead>Fuentes</GridHead>
                    <GridHead>
                      {canEdit ? (
                        <AddColumnButton {...ids} variant="ghost" iconOnly />
                      ) : (
                        <span className="sr-only">Acciones</span>
                      )}
                    </GridHead>
                  </>
                }
              >
                {data.rows.map((r) => {
                  const name = person ? (r.personName ?? "") : r.companyName;
                  return (
                    <GridRow key={r.id}>
                      {person ? (
                        <GridCell sticky>
                          <RowLink href={href({ row: r.id })}>{r.personName}</RowLink>
                        </GridCell>
                      ) : null}
                      <GridCell sticky={!person}>
                        {person ? (
                          r.companyName
                        ) : (
                          <RowLink href={href({ row: r.id })}>{r.companyName}</RowLink>
                        )}
                      </GridCell>
                      <GridCell>{r.website ? <WebLink href={r.website} /> : null}</GridCell>
                      <GridCell title={r.fitReason ?? undefined}>
                        {r.fitScore != null ? <ScoreBar value={r.fitScore} /> : null}
                      </GridCell>
                      <GridCell>
                        <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                      </GridCell>
                      {columns.map((c) => (
                        <GridCell
                          key={c.id}
                          align={c.type === "number" ? "end" : "start"}
                          title={cellTitle(r.cellMeta[c.id])}
                        >
                          <CellState
                            column={c}
                            value={r.data[c.id]}
                            meta={r.cellMeta[c.id]}
                            pending={
                              filledByAgent &&
                              r.status !== "discarded" &&
                              isPendingCell(c, r.data[c.id], r.cellMeta[c.id])
                            }
                          />
                        </GridCell>
                      ))}
                      <GridCell>
                        <span className="inline-flex gap-2">
                          {r.sources.map((src, i) => (
                            <a
                              key={src}
                              href={src}
                              target="_blank"
                              rel="noreferrer"
                              title={src}
                              className="text-accent hover:underline"
                            >
                              {i + 1}
                            </a>
                          ))}
                        </span>
                      </GridCell>
                      <GridCell>
                        <form
                          action={changeProspectStatus.bind(
                            null,
                            projectId,
                            baseId,
                            [r.id],
                            r.status === "discarded" ? "new" : "discarded",
                          )}
                        >
                          {r.status === "discarded" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              iconOnly
                              aria-label={`Recuperar ${name}`}
                              title="Recuperar"
                            >
                              <Undo2 />
                            </Button>
                          ) : (
                            <Button
                              variant="dangerGhost"
                              size="sm"
                              iconOnly
                              aria-label={`Descartar ${name}`}
                              title="Descartar"
                            >
                              <X />
                            </Button>
                          )}
                        </form>
                      </GridCell>
                    </GridRow>
                  );
                })}
              </DataGrid>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>
                {data.matching === data.total
                  ? plural(data.total, "fila", "filas")
                  : `${data.matching} de ${plural(data.total, "fila", "filas")}`}
                {pages > 1 ? ` · página ${page} de ${pages}` : ""}
                {filledByAgent && pendingCells > 0
                  ? ` · ${plural(pendingCells, "celda", "celdas")} por completar en toda la base`
                  : ""}
              </span>
              {filledByAgent ? (
                <span className="flex flex-wrap items-center gap-3">
                  <Pending />
                  <NotFound />
                  <span className="inline-flex items-center gap-1">
                    escrito a mano <Lock className="size-3 text-ink-400" aria-hidden />
                  </span>
                </span>
              ) : null}
              {pages > 1 ? (
                <span className="flex gap-1">
                  {page > 1 ? (
                    <LinkButton href={href({ page: page - 1 })} variant="ghost" size="sm">
                      <ChevronLeft />
                      Anterior
                    </LinkButton>
                  ) : null}
                  {page < pages ? (
                    <LinkButton href={href({ page: page + 1 })} variant="ghost" size="sm">
                      Siguiente
                      <ChevronRight />
                    </LinkButton>
                  ) : null}
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>

      {rowParam === "new" || openRow ? (
        <RowPanel
          key={openRow?.id ?? "new"}
          projectId={projectId}
          base={base}
          row={openRow}
          closeHref={href({ row: undefined })}
          agentFills={filledByAgent}
          canRun={canEdit}
        />
      ) : null}
    </>
  );
}

/** Opens a row in the side panel, keeping the table's filters and page. */
function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} scroll={false} className="hover:text-accent hover:underline">
      {children}
    </Link>
  );
}
