import Link from "next/link";
import { Building2, Lock, Network, Trash2, Undo2, User, X } from "lucide-react";
import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { Drawer } from "@/components/drawer";
import { Badge, Button, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { formatDateTime, plural } from "@/lib/format";
import { isPendingCell, type BaseColumn } from "@/lib/prospect-columns";
import type { CellMeta } from "@/server/db/schema";
import type { ProspectBase } from "@/server/prospects/bases";
import { normalizeDomain, type linkedRows, type ProspectRow } from "@/server/prospects/service";
import { completeProspectsNow } from "../../projects/[projectId]/agents/actions";
import { changeProspectStatus, deleteRowsAction, saveRowAction } from "../actions";
import { LinkField, type LinkValue, type SearchRows } from "../link-picker";
import { COLUMN_ICONS } from "../column-icons";

/** Where a value comes from, under its field. */
function provenance(
  column: BaseColumn,
  value: unknown,
  meta: CellMeta | undefined,
  agentFills: boolean,
): ReactNode {
  if (column.type === "link") {
    return meta?.by === "agent"
      ? `La relacionó el agente · ${formatDateTime(meta.at)}`
      : meta?.by === "user"
        ? `Relacionada a mano · ${formatDateTime(meta.at)}`
        : null;
  }
  if (meta?.notFound) {
    return `El agente lo buscó y no lo encontró publicado · ${formatDateTime(meta.at)}. «Completar esta fila» lo vuelve a buscar.`;
  }
  if (meta?.by === "agent") {
    return (
      <>
        Lo encontró el agente · {formatDateTime(meta.at)}
        {meta.source ? (
          <>
            {" · "}
            <a href={meta.source} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {normalizeDomain(meta.source) ?? "fuente"}
            </a>
          </>
        ) : null}
      </>
    );
  }
  if (meta?.by === "user") {
    return (
      <span className="inline-flex items-center gap-1">
        <Lock className="size-3" aria-hidden />
        Escrito a mano · {formatDateTime(meta.at)}. El agente no lo cambia; vacíalo para que lo busque.
      </span>
    );
  }
  if (column.filledBy === "person") return "La rellena el equipo";
  return agentFills && isPendingCell(column, value, meta)
    ? "Por completar: lo buscará el agente."
    : column.instructions;
}

/** The control for one column, by its type. Its name is `f:<column id>`. */
function CellInput({ column, value }: { column: BaseColumn; value: unknown }) {
  const name = `f:${column.id}`;
  const text = value === null || value === undefined ? "" : String(value);
  switch (column.type) {
    case "long":
      return <Textarea name={name} defaultValue={text} className="min-h-24" />;
    case "number":
      return <Input name={name} type="number" step="any" defaultValue={text} />;
    case "score":
      return (
        <Input name={name} type="number" min={0} max={100} step={1} defaultValue={text} className="w-32" />
      );
    case "date":
      return <Input name={name} type="date" defaultValue={text} className="w-48" />;
    case "bool":
      return (
        <Select
          name={name}
          defaultValue={value === true ? "sí" : value === false ? "no" : ""}
          className="w-40"
        >
          <option value="">—</option>
          <option value="sí">Sí</option>
          <option value="no">No</option>
        </Select>
      );
    case "select":
    case "stage":
      return (
        <Select name={name} defaultValue={text}>
          <option value="">—</option>
          {/* A value kept from before the options changed still shows. */}
          {text && !(column.options ?? []).includes(text) ? <option value={text}>{text}</option> : null}
          {(column.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "multi": {
      const picked = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(column.options ?? []).map((o) => (
            <Chip key={o} name={name} value={o} defaultChecked={picked.includes(o)}>
              {o}
            </Chip>
          ))}
        </div>
      );
    }
    case "email":
      return <Input name={name} type="email" defaultValue={text} />;
    case "phone":
      return <Input name={name} type="tel" defaultValue={text} />;
    case "url":
      return <Input name={name} inputMode="url" defaultValue={text} placeholder="https://" />;
    default:
      return <Input name={name} defaultValue={text} />;
  }
}

/** The relation of the table: the column, the linked table and the row it points at now. */
export type RowLink = {
  column: BaseColumn;
  tableName: string;
  /** Where the linked table is. */
  path: string;
  search: SearchRows;
  value: LinkValue;
};

const STATUS = {
  new: { label: "Nuevo", tone: "accent" },
  accepted: { label: "Nuevo", tone: "accent" },
  exported: { label: "Exportado", tone: "neutral" },
  discarded: { label: "Descartado", tone: "warning" },
} as const;

/**
 * A row of the base in a side panel: every value with where it comes from,
 * editable by any member. Without `row`, the same form adds a row by hand.
 */
export function RowPanel({
  filler,
  base,
  row,
  closeHref,
  canRun = false,
  conversationKey = null,
  link = null,
  linked = null,
  back,
}: {
  /** Project of the prospecting agent that fills this table, if one does. */
  /** The prospecting agent that fills the table, if any. */
  filler: { projectId: string; id: string } | null;
  base: ProspectBase;
  row: ProspectRow | null;
  closeHref: string;
  /** The person can start the agent (owners and admins). */
  canRun?: boolean;
  /** The agent wrote to this row: its conversation in the inbox. */
  conversationKey?: string | null;
  /** The table's relation column, if it has one. */
  link?: RowLink | null;
  /** The rows of other tables that belong to this one (the people of a company). */
  linked?: Awaited<ReturnType<typeof linkedRows>> | null;
  /** Where to go once the row is deleted. */
  back: string;
}) {
  const person = base.rowKind === "person";
  const title = row ? (person ? row.personName || row.companyName : row.companyName) : "Nueva fila";
  return (
    <Drawer
      title={title}
      icon={person ? <User /> : <Building2 />}
      closeHref={closeHref}
      subtitle={
        row ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
            {person ? row.companyName : null}
            <span>
              {row.runId ? "Encontrada por el agente" : "Añadida"} el {formatDateTime(row.createdAt)}
            </span>
            {row.costUsd > 0 ? (
              <span title="Lo que ha costado completarla: el modelo de IA y las búsquedas">
                Completarla: {row.costUsd.toFixed(4)} $
              </span>
            ) : null}
            {conversationKey ? (
              <Link
                href={`/app/conversations?box=all&c=${encodeURIComponent(conversationKey)}`}
                className="text-accent hover:underline"
              >
                Ver la conversación
              </Link>
            ) : null}
          </span>
        ) : (
          `En «${base.name}»`
        )
      }
    >
      <ActionForm
        action={saveRowAction.bind(null, base.id, row?.id ?? null)}
        submitLabel={row ? "Guardar" : "Añadir fila"}
        className="space-y-5"
      >
        {person ? (
          <Field label="Nombre">
            <Input name="personName" required defaultValue={row?.personName ?? ""} />
          </Field>
        ) : null}
        <Field label={person ? "Empresa" : "Nombre de la empresa"} optional={person}>
          <Input name="companyName" required={!person} defaultValue={row?.companyName ?? ""} />
        </Field>
        <Field label="Web" optional>
          <Input name="website" inputMode="url" defaultValue={row?.website ?? ""} placeholder="https://" />
        </Field>
        {base.columns.length ? (
          <div className="space-y-5 border-t border-border pt-5">
            {base.columns.map((c) => {
              const Icon = COLUMN_ICONS[c.type];
              return (
                <Field
                  key={c.id}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="size-3.5 text-muted" aria-hidden />
                      {c.name}
                    </span>
                  }
                  group={c.type === "multi"}
                  hint={
                    row
                      ? provenance(
                          c,
                          row.data[c.id],
                          row.cellMeta[c.id],
                          Boolean(filler) && c.filledBy !== "person",
                        )
                      : c.instructions
                  }
                >
                  {c.type === "link" && link?.column.id === c.id ? (
                    <LinkField
                      name={`f:${c.id}`}
                      defaultValue={link.value}
                      search={link.search}
                      tableName={link.tableName}
                      targetPath={link.path}
                    />
                  ) : c.type === "link" ? null : (
                    <CellInput column={c} value={row?.data[c.id]} />
                  )}
                </Field>
              );
            })}
          </div>
        ) : null}

        {row?.sources.length ? (
          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-medium">Fuentes</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {row.sources.map((src) => (
                <li key={src} className="truncate">
                  <a href={src} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {src}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ActionForm>

      {row && linked?.total ? (
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-medium">Filas relacionadas ({linked.total})</h3>
          <ul className="mt-2 space-y-0.5">
            {linked.rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/app/tables/${r.baseId}?row=${r.id}`}
                  className="-mx-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-ink-50"
                >
                  <Network className="size-3.5 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted">{r.baseName}</span>
                </Link>
              </li>
            ))}
          </ul>
          {linked.total > linked.rows.length ? (
            <p className="mt-1 text-xs text-muted">
              Y {linked.total - linked.rows.length} más: filtra su tabla por esta fila para verlas.
            </p>
          ) : null}
        </div>
      ) : null}

      {row ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <form
            action={changeProspectStatus.bind(
              null,
              base.id,
              [row.id],
              row.status === "discarded" ? "new" : "discarded",
            )}
          >
            {row.status === "discarded" ? (
              <Button variant="ghost" size="sm">
                <Undo2 className="size-4" />
                Recuperar
              </Button>
            ) : (
              <Button variant="dangerGhost" size="sm">
                <X className="size-4" />
                Descartar
              </Button>
            )}
          </form>
          <ConfirmForm
            action={deleteRowsAction.bind(null, base.id, [row.id], back)}
            message={`¿Borrar «${title}»${
              linked?.total
                ? ` y ${plural(linked.total, "fila relacionada", "filas relacionadas")} (${[
                    ...new Set(linked.rows.map((r) => r.baseName)),
                  ].join(", ")})`
                : ""
            }? No se puede deshacer.`}
          >
            <Button variant="dangerGhost" size="sm">
              <Trash2 className="size-4" />
              Borrar
            </Button>
          </ConfirmForm>
          {filler && canRun && row.status !== "discarded" ? (
            <ActionForm
              action={completeProspectsNow.bind(null, filler.projectId, filler.id, [row.id])}
              submitLabel="Completar esta fila"
              submitVariant="secondary"
              cancel={false}
            >
              <input type="hidden" name="back" value={`/app/tables/${base.id}`} />
            </ActionForm>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
