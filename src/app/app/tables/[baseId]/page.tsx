import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  Lock,
  Search,
  Undo2,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { AgentTile, agentState } from "@/components/agent-look-fields";
import { MenuButton } from "@/components/menu-button";
import { connectionCapabilities } from "@/server/connectors/service";
import { listOrgConnections } from "@/server/services/projects";
import { OptionChip } from "@/components/option-chip";
import { DataGrid, GridCell, GridHead, GridRow, NARROW_COLUMN } from "@/components/data-grid";
import {
  filterFields,
  filterOn,
  filterParam,
  parseFilters,
  STATUS_OPTIONS,
  type FilterField,
} from "@/lib/table-filters";
import { Badge, Button, cx, Input, LinkButton, Notice, PageHeader, Tooltip } from "@/components/ui";
import { formatDateTime, plural } from "@/lib/format";
import {
  formatCell,
  isPendingCell,
  linkColumn,
  primaryField,
  stageColumn,
  SYSTEM_FIELD_LABELS,
  systemFields,
  type BaseColumn,
  type SystemField,
} from "@/lib/prospect-columns";
import { PROSPECT_STATUSES } from "@/server/db/schema";
import { projectAccess, requireTenant } from "@/server/auth/session";
import { canSeeBase } from "@/server/services/access";
import { getDb } from "@/server/db/client";
import { baseAgents, getBase, linkedRowsOf, listBaseNames } from "@/server/prospects/bases";
import { completionCost, countPendingCells } from "@/server/prospects/complete";
import { getProspect, linkedRows, listProspects, type ProspectStatus } from "@/server/prospects/service";
import { listAgentRuns } from "@/server/services/agents";
import { listProjects } from "@/server/services/projects";
import { AiNotice } from "../../ai-notice";
import { completeProspectsNow } from "../../projects/[projectId]/agents/actions";
import { FindNowButton } from "../../projects/[projectId]/agents/find-now";
import {
  addRowAction,
  changeProspectStatus,
  moveColumnAction,
  placeColumnAction,
  removeColumnAction,
  retryNotFoundAction,
  saveCellAction,
  saveColumnAction,
  searchLinkRowsAction,
  toggleColumnAction,
  setColumnWidthAction,
  toggleFieldAction,
} from "../actions";
import { LinkCell } from "../link-picker";
import { fillingRows } from "@/server/agents/runs";
import { CellState, cellTitle, COLUMN_ICONS, NotFound, Pending, WebLink } from "../cells";
import { AddColumnHeader, ColumnHeader, FieldHeader, HiddenColumns } from "./column-header";
import { ColumnFilter } from "./column-filter";
import { FilterBar, GroupSelect } from "./filter-bar";
import { EditableCell, ExpandRow, NewRow, type CellEditor, type NewRowField } from "./grid-editing";
import { env } from "@/server/env";
import { TableIntake, TableSettings } from "./table-settings";
import { SendTableModal } from "./send-table";
import { RowPanel } from "./row-panel";
import { KanbanBoard } from "./kanban-board";
import { SegmentedLinks } from "@/components/nav-link";
import { personOfRow } from "@/server/conversations/inbox";

// «Buscar ahora» keeps running after the response.
export const maxDuration = 300;

const PAGE_SIZE = 100;
/** The board shows every row at once, up to this many. */
const BOARD_SIZE = 500;

const STATUS: Record<ProspectStatus, { label: string; tone: "accent" | "neutral" | "warning" }> = {
  new: { label: "Nuevo", tone: "accent" },
  accepted: { label: "Nuevo", tone: "accent" },
  exported: { label: "Exportado", tone: "neutral" },
  discarded: { label: "Descartado", tone: "warning" },
};

/** How a group's value reads in its header. */
function groupLabel(key: string, value: string | null, fields: FilterField[]): string {
  if (value === null || value === "" || value === "[]") return "(vacío)";
  const field = fields.find((f) => f.key === key);
  if (field?.type === "status") return STATUS_OPTIONS[value] ?? value;
  if (field?.type === "bool") return value === "true" ? "Sí" : "No";
  if (field?.type === "multi") {
    try {
      return (JSON.parse(value) as string[]).join(", ") || "(vacío)";
    } catch {
      return value;
    }
  }
  return value;
}

type GridField = { kind: "system"; key: SystemField } | { kind: "column"; column: BaseColumn };
const system = (key: SystemField): GridField => ({ kind: "system", key });

/** How the table sorts by each fixed field (the sources don't sort). */
const SORT_KEYS: Partial<Record<SystemField, string>> = {
  created: "created",
  person: "person",
  company: "name",
  web: "web",
  status: "status",
};

/** The fixed fields people type in the table. */
const SYSTEM_EDITORS: Partial<Record<SystemField, CellEditor>> = {
  person: { type: "text" },
  company: { type: "text" },
  web: { type: "url" },
};

/**
 * After «Completar vacíos» or «Buscar ahora» from this page (?working=<when>)
 * the run may not have begun yet: the page keeps refreshing until it does.
 * A run that ended in the last half hour says what it did.
 */
function watchRuns<R extends { startedAt: Date; finishedAt: Date | null }>(
  idle: boolean,
  runs: R[],
  startedAt: number,
) {
  const now = Date.now();
  const latest = runs[0];
  const starting =
    idle &&
    startedAt > 0 &&
    now - startedAt < 60_000 &&
    !(latest && latest.startedAt.getTime() >= startedAt - 5_000);
  const ended = idle && !starting && latest?.finishedAt && now - latest.finishedAt.getTime() < 30 * 60_000;
  return { starting, lastRun: ended ? runs[0] : null };
}

/** A run cut off by the platform stays "running"; after 10 minutes it isn't really searching. */
function isRecent(startedAt: Date) {
  return Date.now() - new Date(startedAt).getTime() < 10 * 60_000;
}

export default async function TablePage({ params, searchParams }: PageProps<"/app/tables/[baseId]">) {
  const { baseId } = await params;
  const query = await searchParams;
  const tenant = await requireTenant();
  const db = getDb();
  const base = await getBase(db, tenant, baseId);
  if (!base || !canSeeBase(await projectAccess(), base)) notFound();

  const status = PROSPECT_STATUSES.find((s) => s === query.status);
  const q = typeof query.q === "string" ? query.q : "";
  const sort = typeof query.sort === "string" ? query.sort : undefined;
  const dir = query.dir === "asc" || query.dir === "desc" ? query.dir : undefined;
  const page = Math.max(1, Number(query.page) || 1);
  const rowParam = typeof query.row === "string" ? query.row : undefined;
  const canEdit = tenant.role !== "member";
  // With a pipeline column, the table can also be seen as a board (?view=board).
  const stage = stageColumn(base.columns);
  const board = Boolean(stage) && query.view === "board";
  const sending = canEdit && query.send === "1";
  // Filters on any field (?f=) and grouping by one (?group=), in the table view.
  const filterFieldList = filterFields(base.rowKind, base.columns, SYSTEM_FIELD_LABELS);
  const filters = parseFilters(query.f, filterFieldList);
  const group =
    !board && typeof query.group === "string" && filterFieldList.some((f) => f.key === query.group)
      ? query.group
      : undefined;
  const agents = await baseAgents(db, tenant, baseId);
  // The prospecting agent that fills it (the first active one, if several do).
  const prospecting = agents.filter((a) => a.agentType === "prospecting");
  const filler = prospecting.find((a) => a.enabled) ?? prospecting[0] ?? null;
  // A relation column points at another table: its rows are picked by name.
  const link = linkColumn(base.columns);
  const [data, projects, runs, openRow, pendingCells, filling, cost, tableNames] = await Promise.all([
    listProspects(db, tenant, baseId, {
      status,
      q,
      filters,
      group,
      sort,
      dir,
      limit: board ? BOARD_SIZE : PAGE_SIZE,
      offset: board ? 0 : (page - 1) * PAGE_SIZE,
    }),
    canEdit ? listProjects(db, tenant) : Promise.resolve([]),
    filler ? listAgentRuns(db, tenant, filler.projectId, filler.id, 1) : Promise.resolve([]),
    rowParam && rowParam !== "new" ? getProspect(db, tenant, baseId, rowParam).catch(() => null) : null,
    countPendingCells(db, tenant, baseId),
    fillingRows(db, tenant, baseId),
    completionCost(db, tenant, baseId),
    listBaseNames(db, tenant),
  ]);
  const otherTables = tableNames.filter((t) => t.id !== baseId);
  const linkTable = link ? tableNames.find((t) => t.id === link.linkBaseId) : undefined;
  const linkPath = link ? `/app/tables/${link.linkBaseId}` : "";
  const searchLinked = searchLinkRowsAction.bind(null, baseId);
  // The open row: the row it belongs to, and the rows of other tables that belong to it.
  const [openParent, openLinked] = openRow
    ? await Promise.all([
        link && openRow.parentId
          ? getProspect(db, tenant, link.linkBaseId!, openRow.parentId).catch(() => null)
          : null,
        linkedRows(db, tenant, openRow.id),
      ])
    : [null, null];
  const filledByAgent = Boolean(filler);
  const running = filledByAgent && runs[0]?.status === "running" && isRecent(runs[0].startedAt);
  const { starting, lastRun } = watchRuns(filledByAgent && !running, runs, Number(query.working) || 0);
  const columns = base.columns.filter((c) => !c.hidden);
  const person = base.rowKind === "person";
  const primary = primaryField(base.rowKind);
  const hiddenFields = systemFields(base.rowKind).filter(
    (f) => f !== primary && base.hiddenFields.includes(f),
  );
  const shown = (f: SystemField) => systemFields(base.rowKind).includes(f) && !hiddenFields.includes(f);
  // The row's name first, then the people's columns, then the fixed fields.
  const fields: GridField[] = [
    { kind: "system", key: primary },
    ...(["company", "web"] as const).filter((f) => f !== primary && shown(f)).map(system),
    ...columns.map((column) => ({ kind: "column" as const, column })),
    ...(["status", "sources", "created"] as const).filter(shown).map(system),
  ];
  // Widths: what someone dragged, or a default by kind (the row's name wider).
  const widthOf = (f: GridField, i: number) => {
    const key = f.kind === "system" ? f.key : f.column.id;
    const fallback = i === 0 ? 240 : f.kind === "system" && f.key === "created" ? 170 : 180;
    return { key, width: base.columnWidths[key] ?? fallback };
  };
  const gridColumns = [{ key: "id", width: 56 }, ...fields.map(widthOf), { key: "add", width: 72 }];
  const resizeColumn = setColumnWidthAction.bind(null, baseId);
  const hidden = [
    ...hiddenFields.map((f) => ({ id: `field:${f}`, name: SYSTEM_FIELD_LABELS[f] })),
    ...base.columns.filter((c) => c.hidden),
  ];
  const saveCell = saveCellAction.bind(null, baseId);
  const path = `/app/tables/${baseId}`;
  const href = (changes: Record<string, string | number | undefined>) => {
    const params = new URLSearchParams();
    const next = {
      status,
      q: q || undefined,
      sort,
      dir,
      page,
      view: board ? "board" : undefined,
      ...changes,
    };
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "" || (k === "page" && Number(v) === 1)) continue;
      params.set(k, String(v));
    }
    for (const f of filters) params.append("f", filterParam(f));
    if (group && !("group" in changes)) params.set("group", group);
    const s = params.toString();
    return s ? `${path}?${s}` : path;
  };
  const currentSearch = href({}).split("?")[1] ?? "";
  // Grouped by a choice column: its headers show the choice's coloured tag.
  const groupColumn = base.columns.find((c) => c.id === group && (c.type === "select" || c.type === "stage"));
  // The funnel in each header filters by that field («sources» has none).
  const columnFilter = (key: string) => {
    const field = filterFieldList.find((f) => f.key === key);
    return field ? (
      <ColumnFilter field={field} filter={filterOn(filters, key)} path={path} search={currentSearch} />
    ) : undefined;
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

  const destinations = sending
    ? (await listOrgConnections(db, tenant))
        .filter((c) => c.status === "active" && connectionCapabilities(c).includes("table.export"))
        .map((c) => ({ id: c.id, label: c.label, provider: c.provider }))
    : [];

  return (
    <>
      {sending ? (
        <SendTableModal
          baseId={baseId}
          destinations={destinations}
          pending={pendingExport}
          total={data.total}
        />
      ) : null}
      <PageHeader
        icon={person ? <User /> : <Building2 />}
        title={base.name}
        badge={agents.length ? <TableAgents agents={agents} /> : null}
        tip={`Cada fila es ${person ? "una persona" : "una empresa"}. ${filledByAgent ? `La rellena ${filler!.label} y la revisáis las personas del equipo.` : "La rellenáis a mano o desde un formulario; también puede rellenarla un agente."} Haz clic en una celda para escribir en ella. Las columnas se cambian desde su cabecera y se mueven manteniéndola pulsada. Exportar descarga un Excel (CSV) con sus columnas.`}
        actions={
          <>
            {filledByAgent && canEdit && pendingCells > 0 ? (
              <ActionForm
                action={completeProspectsNow.bind(null, filler!.projectId, filler!.id, null)}
                submitLabel={`Completar vacíos (${pendingCells})`}
                submitVariant="secondary"
                className="flex flex-wrap items-center gap-3"
              >
                <input type="hidden" name="back" value={path} />
              </ActionForm>
            ) : null}
            {filledByAgent && canEdit ? (
              <FindNowButton
                projectId={filler!.projectId}
                agentId={filler!.id}
                settings={filler!.settings}
                back={path}
              />
            ) : null}
            {data.total > 0 ? (
              <MenuButton
                label="Exportar"
                icon={<Download />}
                variant={pendingExport > 0 ? "primary" : "secondary"}
                items={[
                  {
                    label: `Exportar nuevos (${pendingExport})`,
                    description: "Los que aún no se han exportado. Quedan marcados como exportados.",
                    href: `${exportUrl}?include=pending`,
                  },
                  {
                    label: `Exportar todo (${data.total})`,
                    description: "Todas las filas, en un Excel (CSV).",
                    href: exportUrl,
                  },
                  ...(canEdit && base.projectId
                    ? [
                        {
                          label: "A otra herramienta…",
                          description: "Google Sheets, Airtable, Trello o monday.com.",
                          href: href({ send: "1" }),
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
            {canEdit ? (
              <TableIntake
                baseId={baseId}
                intakeKey={base.intakeKey}
                appUrl={env().APP_URL}
                person={person}
                columns={base.columns}
              />
            ) : null}
            {canEdit ? (
              <TableSettings
                baseId={baseId}
                name={base.name}
                rows={data.total}
                agents={agents.length}
                projectId={base.projectId}
                projectIds={base.projectIds}
                projects={projects.map((p) => ({ id: p.id, name: p.name }))}
                linked={await linkedRowsOf(db, tenant, baseId)}
              />
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        {filledByAgent ? <AiNotice feature="La búsqueda de prospectos" /> : null}
        {running || starting ? (
          <>
            <AutoRefresh seconds={6} />
            <Notice>
              {filler!.label} está trabajando en esta tabla: lo que encuentre aparece aquí solo, según lo
              guarda (tarda unos minutos).
            </Notice>
          </>
        ) : lastRun ? (
          <Notice
            tone={lastRun.status === "failed" ? "danger" : "success"}
            action={
              <LinkButton
                href={`/app/projects/${filler!.projectId}/agents/${filler!.id}`}
                variant="secondary"
                size="sm"
              >
                Ver el resumen
              </LinkButton>
            }
          >
            {lastRun.status === "failed"
              ? `La última ejecución no ha terminado bien: ${lastRun.error ?? "error desconocido"}`
              : (lastRun.summary ?? "").split("\n\n")[0].replace(/\*\*/g, "") ||
                "La última ejecución ha terminado."}
          </Notice>
        ) : null}

        <>
          <div className="flex flex-wrap items-center gap-2">
            {data.total > 0 ? (
              <>
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
                {!board ? (
                  <FilterBar path={path} search={currentSearch} fields={filterFieldList} filters={filters} />
                ) : null}
              </>
            ) : null}
            <span className="ml-auto flex flex-wrap items-center gap-1">
              {data.total > 0 && !board ? (
                <GroupSelect path={path} search={currentSearch} fields={filterFieldList} group={group} />
              ) : null}
              {stage && data.total > 0 ? (
                <SegmentedLinks
                  label="Vista"
                  options={[
                    { href: href({ view: undefined, page: undefined }), label: "Tabla", active: !board },
                    { href: href({ view: "board", page: undefined }), label: "Tablero", active: board },
                  ]}
                />
              ) : null}
              {canEdit && hidden.length && !board ? (
                <HiddenColumns
                  columns={hidden}
                  show={async (id: string) => {
                    "use server";
                    if (id.startsWith("field:"))
                      await toggleFieldAction(baseId, id.slice(6) as SystemField, false);
                    else await toggleColumnAction(baseId, id, false);
                  }}
                />
              ) : null}
            </span>
          </div>

          {data.total > 0 && data.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nada coincide con este filtro.</p>
          ) : board && stage ? (
            <KanbanBoard
              stages={stage.options ?? []}
              colors={stage.optionColors}
              field={stage.id}
              save={saveCell}
              cards={data.rows.map((r) => ({
                id: r.id,
                seq: r.seq,
                name: (person ? r.personName : r.companyName) || "Sin nombre",
                stage: typeof r.data[stage.id] === "string" ? (r.data[stage.id] as string) : null,
                details: [
                  ...(person && r.companyName ? [r.companyName] : []),
                  ...columns
                    .filter((c) => c.id !== stage.id && formatCell(c, r.data[c.id]))
                    .map((c) => `${c.name}: ${formatCell(c, r.data[c.id])}`),
                ].slice(0, 3),
                discarded: r.status === "discarded",
                href: href({ row: r.id }),
              }))}
            />
          ) : (
            <DataGrid
              columns={gridColumns}
              head={
                <>
                  <GridHead sticky className={cx(NARROW_COLUMN, "px-2")} align="end">
                    {sortLink("id", "ID", "end")}
                  </GridHead>
                  {fields.map((f, i) => {
                    if (f.kind === "system") {
                      const key = SORT_KEYS[f.key];
                      const label = SYSTEM_FIELD_LABELS[f.key];
                      return (
                        <GridHead
                          key={f.key}
                          sticky={i === 0 ? "second" : false}
                          align="start"
                          resize={{ key: f.key, save: resizeColumn }}
                          filter={columnFilter(f.key)}
                        >
                          {canEdit ? (
                            <FieldHeader
                              label={label}
                              sorted={key && sort === key ? (dir ?? "asc") : null}
                              sortHrefs={
                                key
                                  ? {
                                      asc: href({ sort: key, dir: "asc", page: undefined }),
                                      desc: href({ sort: key, dir: "desc", page: undefined }),
                                    }
                                  : undefined
                              }
                              hide={
                                f.key === primary
                                  ? undefined
                                  : toggleFieldAction.bind(null, baseId, f.key, true)
                              }
                            />
                          ) : key ? (
                            sortLink(key, label)
                          ) : (
                            label
                          )}
                        </GridHead>
                      );
                    }
                    const c = f.column;
                    const Icon = COLUMN_ICONS[c.type];
                    const end = c.type === "number";
                    const at = columns.indexOf(c);
                    return (
                      <GridHead
                        key={c.id}
                        align={end ? "end" : "start"}
                        dropId={canEdit ? c.id : undefined}
                        resize={{ key: c.id, save: resizeColumn }}
                        filter={columnFilter(c.id)}
                      >
                        {canEdit ? (
                          <ColumnHeader
                            column={c}
                            first={at === 0}
                            last={at === columns.length - 1}
                            sorted={sort === c.id ? (dir ?? "asc") : null}
                            sortHrefs={{
                              asc: href({ sort: c.id, dir: "asc", page: undefined }),
                              desc: href({ sort: c.id, dir: "desc", page: undefined }),
                            }}
                            save={saveColumnAction.bind(null, baseId, c.id)}
                            move={moveColumnAction.bind(null, baseId, c.id)}
                            place={placeColumnAction.bind(null, baseId, c.id)}
                            hide={toggleColumnAction.bind(null, baseId, c.id, true)}
                            remove={removeColumnAction.bind(null, baseId, c.id)}
                            retry={retryNotFoundAction.bind(null, baseId, c.id)}
                            tables={otherTables}
                          />
                        ) : (
                          sortLink(
                            c.id,
                            <>
                              <Icon />
                              {c.name}
                            </>,
                            end ? "end" : "start",
                          )
                        )}
                      </GridHead>
                    );
                  })}
                  <GridHead>
                    {canEdit ? (
                      <AddColumnHeader
                        save={saveColumnAction.bind(null, baseId, null)}
                        existing={base.columns.map((c) => c.name)}
                        rowKind={base.rowKind}
                        tables={otherTables}
                        hiddenFields={hiddenFields}
                        toggleField={toggleFieldAction.bind(null, baseId)}
                      />
                    ) : (
                      <span className="sr-only">Acciones</span>
                    )}
                  </GridHead>
                </>
              }
            >
              {data.rows.map((r, n) => {
                const name = (person ? r.personName : r.companyName) || "esta fila";
                // Grouped: a header before the first row of each value, with how many there are.
                const startsGroup = group && (n === 0 || data.rows[n - 1].groupValue !== r.groupValue);
                const groupCount = data.groups?.find((g) => g.value === r.groupValue)?.n ?? 0;
                return (
                  <Fragment key={r.id}>
                    {startsGroup ? (
                      <tr>
                        <td
                          colSpan={gridColumns.length}
                          className="h-9 border-b border-border bg-ink-50 px-3 text-xs font-medium text-ink-700"
                        >
                          <span className="sticky left-3">
                            {groupColumn && r.groupValue ? (
                              <OptionChip column={groupColumn} value={r.groupValue} />
                            ) : (
                              groupLabel(group, r.groupValue, filterFieldList)
                            )}{" "}
                            <span className="font-normal text-muted tabular-nums">· {groupCount}</span>
                          </span>
                        </td>
                      </tr>
                    ) : null}
                    <GridRow>
                      <GridCell
                        sticky
                        align="end"
                        className={cx(NARROW_COLUMN, "px-2 font-normal text-muted")}
                      >
                        {r.seq}
                      </GridCell>
                      {fields.map((f, i) => {
                        if (f.kind === "column" && f.column.type === "link") {
                          const c = f.column;
                          return (
                            <GridCell key={c.id}>
                              <LinkCell
                                rowId={r.id}
                                field={c.id}
                                value={r.parentId ? { id: r.parentId, name: r.parentName ?? "" } : null}
                                save={saveCell}
                                search={searchLinked}
                                label={`${c.name} de ${name}`}
                                tableName={linkTable?.name ?? c.name}
                                targetPath={`/app/tables/${c.linkBaseId}`}
                                canEdit={c.id === link?.id}
                              />
                            </GridCell>
                          );
                        }
                        if (f.kind === "column") {
                          const c = f.column;
                          return (
                            <GridCell
                              key={c.id}
                              align={c.type === "number" ? "end" : "start"}
                              title={filledByAgent ? cellTitle(r.cellMeta[c.id]) : undefined}
                            >
                              <EditableCell
                                rowId={r.id}
                                field={c.id}
                                editor={{ type: c.type, options: c.options }}
                                value={r.data[c.id]}
                                save={saveCell}
                                label={`${c.name} de ${name}`}
                              >
                                <CellState
                                  column={c}
                                  value={r.data[c.id]}
                                  meta={r.cellMeta[c.id]}
                                  agent={filledByAgent}
                                  pending={
                                    filledByAgent &&
                                    r.status !== "discarded" &&
                                    isPendingCell(c, r.data[c.id], r.cellMeta[c.id])
                                  }
                                  filling={filling.has(r.id)}
                                />
                              </EditableCell>
                            </GridCell>
                          );
                        }
                        const label = `${SYSTEM_FIELD_LABELS[f.key]} de ${name}`;
                        switch (f.key) {
                          case "person":
                          case "company": {
                            const value = f.key === "person" ? r.personName : r.companyName;
                            return (
                              <GridCell
                                key={f.key}
                                sticky={i === 0 ? "second" : false}
                                className={i === 0 ? "pr-8" : undefined}
                              >
                                <EditableCell
                                  rowId={r.id}
                                  field={f.key}
                                  editor={{ type: "text" }}
                                  value={value}
                                  save={saveCell}
                                  label={label}
                                >
                                  {value}
                                </EditableCell>
                                {i === 0 ? <ExpandRow href={href({ row: r.id })} label={name} /> : null}
                              </GridCell>
                            );
                          }
                          case "web":
                            return (
                              <GridCell key={f.key}>
                                <EditableCell
                                  rowId={r.id}
                                  field="web"
                                  editor={{ type: "url" }}
                                  value={r.website}
                                  save={saveCell}
                                  label={label}
                                >
                                  {r.website ? <WebLink href={r.website} /> : null}
                                </EditableCell>
                              </GridCell>
                            );
                          case "status":
                            return (
                              <GridCell key={f.key}>
                                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                              </GridCell>
                            );
                          case "created":
                            return (
                              <GridCell key={f.key} className="text-muted tabular-nums">
                                {formatDateTime(r.createdAt)}
                              </GridCell>
                            );
                          case "sources":
                            return (
                              <GridCell key={f.key}>
                                <span className="inline-flex gap-2">
                                  {r.sources.map((src, n) => (
                                    <a
                                      key={src}
                                      href={src}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={src}
                                      className="text-accent hover:underline"
                                    >
                                      {n + 1}
                                    </a>
                                  ))}
                                </span>
                              </GridCell>
                            );
                        }
                      })}
                      <GridCell>
                        <form
                          action={changeProspectStatus.bind(
                            null,
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
                  </Fragment>
                );
              })}
              <NewRow
                startOpen={data.total === 0}
                add={addRowAction.bind(null, baseId)}
                fields={[
                  { key: "_id", editor: null, sticky: true },
                  ...fields.map((f, i): NewRowField => {
                    // The relation is picked once the row exists.
                    if (f.kind === "column" && f.column.type === "link")
                      return { key: f.column.id, editor: null };
                    if (f.kind === "column") {
                      return {
                        key: f.column.id,
                        editor: { type: f.column.type, options: f.column.options },
                        label: f.column.name,
                      };
                    }
                    const editor = SYSTEM_EDITORS[f.key];
                    return editor
                      ? {
                          key: f.key,
                          editor,
                          label: SYSTEM_FIELD_LABELS[f.key],
                          sticky: i === 0 ? "second" : undefined,
                          required: f.key === primary,
                        }
                      : { key: f.key, editor: null };
                  }),
                  { key: "_actions", editor: null },
                ]}
              />
              {data.total === 0
                ? [0, 1].map((n) => (
                    <GridRow key={`empty-${n}`}>
                      <GridCell sticky className={NARROW_COLUMN} />
                      {fields.map((f, i) => (
                        <GridCell
                          key={f.kind === "system" ? f.key : f.column.id}
                          sticky={i === 0 ? "second" : false}
                        />
                      ))}
                      <GridCell />
                    </GridRow>
                  ))
                : null}
            </DataGrid>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>
              {data.matching === data.total
                ? plural(data.total, "fila", "filas")
                : `${data.matching} de ${plural(data.total, "fila", "filas")}`}
              {board
                ? data.matching > BOARD_SIZE
                  ? ` · el tablero muestra las ${BOARD_SIZE} primeras`
                  : ""
                : pages > 1
                  ? ` · página ${page} de ${pages}`
                  : ""}
              {filledByAgent && pendingCells > 0
                ? ` · ${plural(pendingCells, "celda", "celdas")} por completar en toda la tabla`
                : ""}
              {cost.rows > 0
                ? ` · completar ${plural(cost.rows, "fila", "filas")} ha costado ${cost.usd.toFixed(2)} $ (${(cost.usd / cost.rows).toFixed(4)} $ por fila)`
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
            {pages > 1 && !board ? (
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
      </div>

      {rowParam === "new" || openRow ? (
        <RowPanel
          key={openRow?.id ?? "new"}
          filler={filler ? { projectId: filler.projectId, id: filler.id } : null}
          base={base}
          row={openRow}
          closeHref={href({ row: undefined })}
          canRun={canEdit}
          conversationKey={openRow ? await personOfRow(db, tenant, openRow.id) : null}
          link={
            link
              ? {
                  column: link,
                  tableName: linkTable?.name ?? link.name,
                  path: linkPath,
                  search: searchLinked,
                  value:
                    openRow?.parentId && openParent
                      ? {
                          id: openParent.id,
                          name: openParent.personName || openParent.companyName,
                        }
                      : null,
                }
              : null
          }
          linked={openLinked}
          back={href({ row: undefined })}
        />
      ) : null}
    </>
  );
}

/** The agents that work on the table, as their avatars (each opens its agent). */
function TableAgents({
  agents,
}: {
  agents: {
    id: string;
    projectId: string;
    projectName: string;
    agentType: string;
    label: string;
    icon: string | null;
    color: string | null;
    enabled: boolean;
    working: boolean;
  }[];
}) {
  const STATE = { working: "trabajando", idle: "en reposo", paused: "en pausa" } as const;
  return (
    <span className="ml-1 flex items-center gap-1.5">
      {agents.map((a) => (
        <Tooltip key={a.id} content={`${a.label} · ${a.projectName} · ${STATE[agentState(a)]}`} side="bottom">
          <Link
            href={`/app/projects/${a.projectId}/agents/${a.id}`}
            aria-label={`${a.label} (${a.projectName})`}
            className="rounded-lg transition-transform hover:-translate-y-0.5"
          >
            <AgentTile type={a.agentType} icon={a.icon} color={a.color} size="sm" state={agentState(a)} />
          </Link>
        </Tooltip>
      ))}
    </span>
  );
}
