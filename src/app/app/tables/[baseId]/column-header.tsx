"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  EyeOff,
  Eye,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import type { FormAction } from "@/components/action-form";
import { Popover } from "@/components/popover";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, cx } from "@/components/ui";
import { COLUMN_TYPE_LABELS, type BaseColumn, type RowKind, type SystemField } from "@/lib/prospect-columns";
import { columnCatalog, type CatalogColumn } from "@/lib/column-catalog";
import { COLUMN_ICONS } from "../column-icons";
import { ColumnForm, type LinkTarget } from "../column-form";
import { useColumnDrag, type DropTarget } from "./column-drag";

const FILLED_BY_LABELS = {
  agent: "La rellena el agente",
  person: "La rellena una persona",
  both: "Agente y personas",
};

const item =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-ink-100 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted";

/** Runs a server action from a menu item, then closes the menu. */
function ActionItem({
  run,
  close,
  confirm,
  disabled,
  danger,
  children,
}: {
  run: () => Promise<void>;
  close: () => void;
  confirm?: string;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          await run();
          close();
        });
      }}
      className={cx(item, danger && "text-danger [&_svg]:text-danger")}
    >
      {children}
    </button>
  );
}

/**
 * A column's header: clicking it opens its menu, as in a spreadsheet —
 * sort, edit (name, type, options, how it's filled), move, hide or delete.
 * Press and hold (or drag with the mouse) to move it to another place.
 */
export function ColumnHeader({
  column,
  first,
  last,
  sorted,
  sortHrefs,
  save,
  move,
  place,
  hide,
  remove,
  retry,
  tables,
}: {
  column: BaseColumn;
  first: boolean;
  last: boolean;
  sorted: "asc" | "desc" | null;
  /** Links that sort the table by this column. */
  sortHrefs: { asc: string; desc: string };
  save: FormAction;
  move: (direction: -1 | 1) => Promise<void>;
  place: (target: DropTarget) => Promise<void>;
  hide: () => Promise<void>;
  remove: () => Promise<void>;
  /** Clears its «no encontrado» cells; says how many. */
  retry: () => Promise<string>;
  /** The other tables, for a relation. */
  tables?: LinkTarget[];
}) {
  const toast = useToast();
  const [view, setView] = useState<"menu" | "edit">("menu");
  const [, start] = useTransition();
  const drag = useColumnDrag(column.id, column.name, (target) => start(() => place(target)));
  const Icon = COLUMN_ICONS[column.type];
  return (
    <span {...drag} className="inline-flex touch-manipulation select-none [-webkit-touch-callout:none]">
      <Popover
        triggerLabel={`Opciones de la columna «${column.name}»`}
        triggerClassName="-mx-1 inline-flex cursor-grab items-center gap-1.5 rounded px-1 py-0.5 hover:bg-ink-100 hover:text-foreground active:cursor-grabbing [&_svg]:size-3.5 [&_svg]:text-muted"
        trigger={
          <>
            <Icon />
            {column.name}
            {sorted === "asc" ? <ArrowUp /> : sorted === "desc" ? <ArrowDown /> : null}
          </>
        }
      >
        {(close) =>
          view === "edit" ? (
            <div className="space-y-4">
              <p className="font-semibold">Editar «{column.name}»</p>
              <ColumnForm action={save} column={column} tables={tables} />
            </div>
          ) : (
            <div className="-m-2 space-y-1">
              <div className="px-2 pt-1 pb-2">
                <p className="font-semibold">{column.name}</p>
                <p className="text-xs text-muted">
                  {column.type === "link"
                    ? `Relación con «${tables?.find((t) => t.id === column.linkBaseId)?.name ?? "otra tabla"}»`
                    : `${COLUMN_TYPE_LABELS[column.type]} · ${FILLED_BY_LABELS[column.filledBy]}`}
                </p>
              </div>
              <button type="button" className={item} onClick={() => setView("edit")}>
                <Pencil />
                Editar columna
              </button>
              <Link href={sortHrefs.asc} className={item} onClick={close} scroll={false}>
                <ArrowUp />
                Ordenar de menor a mayor
              </Link>
              <Link href={sortHrefs.desc} className={item} onClick={close} scroll={false}>
                <ArrowDown />
                Ordenar de mayor a menor
              </Link>
              <ActionItem run={() => move(-1)} close={close} disabled={first}>
                <ArrowLeft />
                Mover a la izquierda
              </ActionItem>
              <ActionItem run={() => move(1)} close={close} disabled={last}>
                <ArrowRight />
                Mover a la derecha
              </ActionItem>
              {column.filledBy !== "person" && column.type !== "link" ? (
                <ActionItem run={async () => toast?.({ ok: true, message: await retry() })} close={close}>
                  <RotateCcw />
                  Volver a buscar lo no encontrado
                </ActionItem>
              ) : null}
              <ActionItem run={hide} close={close}>
                <EyeOff />
                Ocultar (sus valores se conservan)
              </ActionItem>
              <div className="my-1 border-t border-border" />
              <ActionItem
                run={remove}
                close={close}
                danger
                confirm={`¿Borrar la columna «${column.name}» y todos sus valores? No se puede deshacer.`}
              >
                <Trash2 />
                Borrar columna
              </ActionItem>
            </div>
          )
        }
      </Popover>
    </span>
  );
}

/**
 * The header of a fixed field (name, web, fit…): sort it, or hide it unless
 * it's the row's name.
 */
export function FieldHeader({
  label,
  sorted,
  sortHrefs,
  hide,
}: {
  label: string;
  sorted: "asc" | "desc" | null;
  sortHrefs?: { asc: string; desc: string };
  /** Absent for the row's name, which always shows. */
  hide?: () => Promise<void>;
}) {
  return (
    <Popover
      triggerLabel={`Opciones de «${label}»`}
      triggerClassName="-mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-ink-100 hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted"
      trigger={
        <>
          {label}
          {sorted === "asc" ? <ArrowUp /> : sorted === "desc" ? <ArrowDown /> : null}
        </>
      }
    >
      {(close) => (
        <div className="-m-2 space-y-1">
          <div className="px-2 pt-1 pb-2">
            <p className="font-semibold">{label}</p>
            <p className="text-xs text-muted">
              {hide ? "Campo de SalesMate" : "El nombre de cada fila: no se puede ocultar"}
            </p>
          </div>
          {sortHrefs ? (
            <>
              <Link href={sortHrefs.asc} className={item} onClick={close} scroll={false}>
                <ArrowUp />
                Ordenar de menor a mayor
              </Link>
              <Link href={sortHrefs.desc} className={item} onClick={close} scroll={false}>
                <ArrowDown />
                Ordenar de mayor a menor
              </Link>
            </>
          ) : null}
          {hide ? (
            <ActionItem run={hide} close={close}>
              <EyeOff />
              Ocultar (sus valores se conservan)
            </ActionItem>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

/**
 * The «+» at the end of the header: a new column, written by hand or picked
 * from a catalogue of common ones (no AI: the same handful suits any table).
 */
export function AddColumnHeader({
  save,
  existing,
  rowKind,
  tables,
  hiddenFields = [],
  toggleField,
}: {
  save: FormAction;
  existing: string[];
  rowKind: RowKind;
  /** The other tables, for a relation. */
  tables?: LinkTarget[];
  /** The fixed fields hidden from the table: the catalogue offers some of them. */
  hiddenFields?: SystemField[];
  /** Shows (false) or hides a fixed field. */
  toggleField?: (field: SystemField, hidden: boolean) => Promise<void>;
}) {
  const toast = useToast();
  const [view, setView] = useState<"form" | "suggest">("form");
  const [added, setAdded] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const taken = new Set([...existing, ...added].map((n) => n.toLowerCase()));
  const isTaken = (c: CatalogColumn) =>
    c.field ? !hiddenFields.includes(c.field) || added.includes(c.name) : taken.has(c.name.toLowerCase());

  const add = (c: CatalogColumn) =>
    start(async () => {
      if (c.field) {
        await toggleField?.(c.field, false);
        setAdded((a) => [...a, c.name]);
        toast?.({ ok: true, message: `«${c.name}» ya se ve en la tabla.` });
        return;
      }
      const form = new FormData();
      form.set("name", c.name);
      form.set("type", c.type);
      for (const o of c.options ?? []) form.append("options", o);
      if (c.instructions) form.set("instructions", c.instructions);
      form.set("filledBy", c.filledBy ?? "agent");
      const result = await save(null, form);
      if (result?.ok) setAdded((a) => [...a, c.name]);
      toast?.({ ok: Boolean(result?.ok), message: result?.message ?? "" });
    });

  return (
    <Popover
      width="md"
      align="end"
      triggerLabel="Añadir columna"
      triggerClassName={buttonClass({ variant: "ghost", size: "sm", iconOnly: true })}
      trigger={<Plus />}
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-ink-50 p-1 text-sm">
          {(
            [
              ["form", "Nueva columna"],
              ["suggest", "Sugerencias"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cx(
                "flex-1 rounded-md px-3 py-1.5 transition-colors",
                view === key ? "bg-surface font-medium shadow-xs" : "text-ink-700 hover:bg-ink-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {view === "form" ? (
          <ColumnForm action={save} tables={tables} />
        ) : (
          <div className="space-y-4">
            {columnCatalog(rowKind).map((group) => (
              <section key={group.title} className="space-y-2">
                <h4 className="text-xs font-medium tracking-wide text-muted uppercase">{group.title}</h4>
                <ul className="space-y-1.5">
                  {group.columns
                    // A fixed field only where the table can show it.
                    .filter((c) => !c.field || toggleField)
                    .map((c) => {
                      const Icon = COLUMN_ICONS[c.type];
                      const shown = isTaken(c);
                      return (
                        <li
                          key={c.name}
                          title={c.instructions}
                          className="flex items-center gap-3 rounded-lg border border-border px-2.5 py-2"
                        >
                          <Icon className="size-4 shrink-0 text-muted" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{c.name}</span>
                            <span className="block text-xs text-muted">
                              {c.field ? "Campo de SalesMate" : COLUMN_TYPE_LABELS[c.type]} ·{" "}
                              {FILLED_BY_LABELS[c.filledBy ?? "agent"]}
                            </span>
                          </span>
                          {shown ? (
                            <Badge tone="success">Añadida</Badge>
                          ) : (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => add(c)}
                              className={buttonClass({ variant: "secondary", size: "sm" })}
                            >
                              Añadir
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Popover>
  );
}

/** Columns (and fixed fields) hidden from the table, to bring back. */
export function HiddenColumns({
  columns,
  show,
}: {
  columns: { id: string; name: string }[];
  show: (id: string) => Promise<void>;
}) {
  return (
    <Popover
      triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
      trigger={
        <>
          <EyeOff />
          {columns.length === 1 ? "1 columna oculta" : `${columns.length} columnas ocultas`}
        </>
      }
    >
      {(close) => (
        <div className="-m-2 space-y-1">
          {columns.map((c) => (
            <ActionItem key={c.id} run={() => show(c.id)} close={close}>
              <Eye />
              Mostrar «{c.name}»
            </ActionItem>
          ))}
        </div>
      )}
    </Popover>
  );
}
