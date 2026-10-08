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
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import type { FormAction } from "@/components/action-form";
import { Popover } from "@/components/popover";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, cx } from "@/components/ui";
import { COLUMN_TYPE_LABELS, type BaseColumn, type RowKind } from "@/lib/prospect-columns";
import type { ProposedColumn } from "@/server/prospects/propose-columns";
import { COLUMN_ICONS } from "../column-icons";
import { ColumnForm } from "../column-form";

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
 */
export function ColumnHeader({
  column,
  first,
  last,
  sorted,
  sortHrefs,
  save,
  move,
  hide,
  remove,
}: {
  column: BaseColumn;
  first: boolean;
  last: boolean;
  sorted: "asc" | "desc" | null;
  /** Links that sort the table by this column. */
  sortHrefs: { asc: string; desc: string };
  save: FormAction;
  move: (direction: -1 | 1) => Promise<void>;
  hide: () => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [view, setView] = useState<"menu" | "edit">("menu");
  const Icon = COLUMN_ICONS[column.type];
  return (
    <Popover
      triggerLabel={`Opciones de la columna «${column.name}»`}
      triggerClassName="-mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-ink-100 hover:text-foreground [&_svg]:size-3.5 [&_svg]:text-muted"
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
            <ColumnForm action={save} column={column} />
          </div>
        ) : (
          <div className="-m-2 space-y-1">
            <div className="px-2 pt-1 pb-2">
              <p className="font-semibold">{column.name}</p>
              <p className="text-xs text-muted">
                {COLUMN_TYPE_LABELS[column.type]} · {FILLED_BY_LABELS[column.filledBy]}
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
  );
}

/**
 * The «+» at the end of the header: a new column, written by hand or picked
 * from the AI's suggestions for this table.
 */
export function AddColumnHeader({
  save,
  suggest,
  existing,
  rowKind,
  name,
}: {
  save: FormAction;
  suggest: (input: {
    rowKind: RowKind;
    name: string;
    brief: string;
  }) => Promise<{ ok: boolean; message?: string; columns: ProposedColumn[] }>;
  existing: string[];
  rowKind: RowKind;
  name: string;
}) {
  const toast = useToast();
  const [view, setView] = useState<"form" | "suggest">("form");
  const [suggestions, setSuggestions] = useState<ProposedColumn[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const taken = new Set([...existing, ...added].map((n) => n.toLowerCase()));

  const load = () =>
    start(async () => {
      const result = await suggest({ rowKind, name, brief: "" });
      setNote(result.ok ? null : (result.message ?? null));
      setSuggestions(result.columns);
    });
  const add = (c: ProposedColumn) =>
    start(async () => {
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
              onClick={() => {
                setView(key);
                if (key === "suggest" && !suggestions && !pending) load();
              }}
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
          <ColumnForm action={save} />
        ) : (
          <div className="space-y-3">
            {note ? <p className="text-xs text-muted">{note}</p> : null}
            {!suggestions ? (
              <p className="flex items-center gap-2 text-muted">
                <Sparkles className="size-4" /> Pensando columnas para «{name}»…
              </p>
            ) : (
              <ul className="space-y-2">
                {suggestions.map((c) => {
                  const Icon = COLUMN_ICONS[c.type];
                  const isTaken = taken.has(c.name.toLowerCase());
                  return (
                    <li key={c.name} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {c.name}
                          <span className="text-xs font-normal text-muted">{COLUMN_TYPE_LABELS[c.type]}</span>
                        </p>
                        {c.instructions ? (
                          <p className="mt-0.5 text-xs text-muted">{c.instructions}</p>
                        ) : null}
                      </div>
                      {isTaken ? (
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
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

/** Columns hidden from the table, to bring back. */
export function HiddenColumns({
  columns,
  show,
}: {
  columns: BaseColumn[];
  show: (columnId: string) => Promise<void>;
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
