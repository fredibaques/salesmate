"use client";

import { Check, Maximize2, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { FormState } from "@/components/action-form";
import { stickyLeft } from "@/components/data-grid";
import { Popover } from "@/components/popover";
import { useToast } from "@/components/toast";
import { buttonClass, cx } from "@/components/ui";
import type { ColumnType } from "@/lib/prospect-columns";

/**
 * Typing in the table, as in a spreadsheet: a click on a cell edits it in
 * place (Enter or leaving it saves, Escape cancels), and the last line adds
 * a row as it's typed.
 */

export type CellValue = string | boolean | string[] | null;
export type CellEditor = { type: ColumnType; options?: string[] };
export type SaveCell = (rowId: string, key: string, value: CellValue) => Promise<FormState>;

/** A stored value as the text an input starts with. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function inputType(type: ColumnType) {
  if (type === "number" || type === "score") return "number";
  if (type === "date") return "date";
  if (type === "email") return "email";
  return "text";
}

const fieldClass =
  "w-full min-w-0 rounded-sm bg-surface px-1.5 py-1 text-sm outline-2 outline-accent placeholder:text-ink-400";

/** The empty cells of the new row: quiet until they get the focus. */
const newFieldClass =
  "w-full min-w-28 rounded-sm bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-ink-400 hover:bg-surface focus:bg-surface focus:outline-2 focus:outline-accent";

/** One cell of a row that people can type in. Shows `children` until clicked. */
export function EditableCell({
  rowId,
  field,
  editor,
  value,
  save,
  label,
  children,
}: {
  rowId: string;
  /** The column id, or a fixed field's key (company, person, web, fit). */
  field: string;
  editor: CellEditor;
  value: unknown;
  save: SaveCell;
  /** What the cell is, for screen readers: «Ciudad de Autos Ruiz». */
  label: string;
  children: ReactNode;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commit = (next: CellValue) => {
    setEditing(false);
    const before = Array.isArray(value) ? value : asText(value);
    if (JSON.stringify(next ?? "") === JSON.stringify(before)) return;
    setDraft(Array.isArray(next) ? next.join(", ") : typeof next === "boolean" ? null : (next ?? ""));
    start(async () => {
      const result = await save(rowId, field, next);
      if (!result?.ok) toast?.({ ok: false, message: result?.message ?? "No se ha podido guardar." });
      setDraft(null);
    });
  };

  if (editor.type === "bool") {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        disabled={pending}
        onChange={(e) => commit(e.target.checked)}
        className="size-4"
      />
    );
  }

  if (editor.type === "select" || editor.type === "multi") {
    const multi = editor.type === "multi";
    const picked = Array.isArray(value) ? (value as string[]) : value ? [String(value)] : [];
    return (
      <Popover
        triggerLabel={`Editar ${label}`}
        triggerClassName="-mx-3 flex h-10 w-[calc(100%+1.5rem)] min-w-24 items-center px-3 text-left hover:bg-ink-50"
        trigger={draft !== null ? <span className="text-muted">{draft}</span> : children}
      >
        {(close) => (
          <div className="-m-2 space-y-0.5">
            {(editor.options ?? []).map((o) => {
              const on = picked.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    if (!multi) {
                      close();
                      commit(on ? null : o);
                      return;
                    }
                    commit(on ? picked.filter((p) => p !== o) : [...picked, o]);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-ink-100"
                >
                  <span
                    className={cx(
                      "flex size-4 shrink-0 items-center justify-center border",
                      multi ? "rounded-sm" : "rounded-full",
                      on ? "border-accent bg-accent text-white" : "border-border-strong",
                    )}
                  >
                    {on ? <Check className="size-3" /> : null}
                  </span>
                  {o}
                </button>
              );
            })}
            {!editor.options?.length ? (
              <p className="px-2 py-1.5 text-sm text-muted">Esta columna no tiene opciones todavía.</p>
            ) : null}
          </div>
        )}
      </Popover>
    );
  }

  if (editing) {
    const initial = asText(value);
    const onKey = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditing(false);
      } else if (e.key === "Enter" && (editor.type !== "long" || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commit(e.currentTarget.value);
      }
    };
    return editor.type === "long" ? (
      <textarea
        autoFocus
        aria-label={label}
        defaultValue={initial}
        rows={3}
        onKeyDown={onKey}
        onBlur={(e) => commit(e.target.value)}
        className={cx(fieldClass, "my-1 min-w-56 resize-y align-top whitespace-pre-wrap")}
      />
    ) : (
      <input
        autoFocus
        aria-label={label}
        type={inputType(editor.type)}
        min={editor.type === "score" ? 0 : undefined}
        max={editor.type === "score" ? 100 : undefined}
        defaultValue={initial}
        onKeyDown={onKey}
        onBlur={(e) => commit(e.target.value)}
        onFocus={(e) => e.currentTarget.select?.()}
        className={cx(fieldClass, "min-w-32")}
      />
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Editar ${label}`}
      onClick={(e) => {
        // Links inside the cell (a web, a source) keep working.
        if ((e.target as Element).closest("a")) return;
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={cx(
        "-mx-3 flex h-10 min-w-16 cursor-text items-center px-3 outline-none hover:bg-ink-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        pending && "opacity-60",
      )}
    >
      {draft !== null ? draft : children}
    </div>
  );
}

/** Opens the whole row in the side panel (from the row's name). */
export function ExpandRow({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-label={`Abrir ${label}`}
      title="Abrir la fila"
      className="absolute top-1/2 right-1 hidden -translate-y-1/2 rounded p-1 text-muted group-hover/row:block hover:bg-ink-100 hover:text-foreground focus-visible:block"
    >
      <Maximize2 className="size-3.5" />
    </Link>
  );
}

export type NewRowField =
  | { key: string; editor: CellEditor; label: string; sticky?: boolean | "second"; required?: boolean }
  | { key: string; editor: null; sticky?: boolean | "second" };

/**
 * The table's last line: «+ Añadir fila» turns into empty cells to type in.
 * Enter saves the row and leaves a new empty line ready for the next one.
 */
export function NewRow({
  fields,
  add,
  startOpen = false,
}: {
  /** Every cell of the line, in the table's order (null editor = nothing to type). */
  fields: NewRowField[];
  add: (values: Record<string, CellValue>) => Promise<FormState>;
  startOpen?: boolean;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(startOpen);
  const [pending, start] = useTransition();
  const [round, setRound] = useState(0);
  const line = useRef<HTMLTableRowElement>(null);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && round > 0) first.current?.focus();
  }, [open, round]);

  const submit = () => {
    if (!line.current) return;
    const values: Record<string, CellValue> = {};
    for (const el of line.current.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-key]")) {
      const key = el.dataset.key!;
      if (el instanceof HTMLInputElement && el.type === "checkbox") {
        if (el.checked) values[key] = true;
      } else if (el.value.trim()) values[key] = el.value;
    }
    if (Object.keys(values).length === 0) return;
    start(async () => {
      const result = await add(values);
      if (result?.ok) {
        // A fresh empty line for the next row.
        setRound((r) => r + 1);
        if (result.message && result.message !== "Fila añadida.") toast?.(result);
      } else {
        toast?.({ ok: false, message: result?.message ?? "No se ha podido añadir la fila." });
      }
    });
  };

  if (!open) {
    return (
      <tr>
        <td colSpan={fields.length} className="h-10 border-b border-ink-100 p-0">
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              setRound((r) => r + 1);
            }}
            className="sticky left-0 flex h-10 items-center gap-2 px-3 text-sm text-muted transition-colors hover:text-foreground"
          >
            <Plus className="size-4" />
            Añadir fila
          </button>
        </td>
      </tr>
    );
  }

  // The first field that takes text gets the focus.
  const firstText = fields.findIndex(
    (f) => f.editor && f.editor.type !== "bool" && f.editor.type !== "select",
  );
  return (
    <tr
      ref={line}
      key={round}
      className="bg-brand-50"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as Element).tagName === "INPUT") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          setOpen(false);
        }
      }}
    >
      {fields.map((f, i) => {
        const isFirst = i === firstText;
        return (
          <td
            key={f.key}
            className={cx(
              "h-10 border-r border-b border-ink-100 px-1.5 whitespace-nowrap",
              f.sticky &&
                cx("sticky z-10 bg-brand-50 shadow-[1px_0_0_var(--color-border)]", stickyLeft(f.sticky)),
            )}
          >
            {!f.editor ? (
              i === fields.length - 1 ? (
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending}
                  aria-label="Guardar la fila"
                  title="Guardar (Enter)"
                  className={buttonClass({ variant: "ghost", size: "sm", iconOnly: true })}
                >
                  <Check />
                </button>
              ) : null
            ) : f.editor.type === "bool" ? (
              <input type="checkbox" data-key={f.key} aria-label={f.label} className="mx-1.5 size-4" />
            ) : f.editor.type === "select" ? (
              <select data-key={f.key} aria-label={f.label} defaultValue="" className={newFieldClass}>
                <option value="" />
                {(f.editor.options ?? []).map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                ref={isFirst ? first : undefined}
                data-key={f.key}
                aria-label={f.label}
                placeholder={
                  f.required
                    ? f.label
                    : f.editor.type === "multi"
                      ? (f.editor.options ?? []).slice(0, 3).join(", ")
                      : undefined
                }
                type={inputType(f.editor.type)}
                min={f.editor.type === "score" ? 0 : undefined}
                max={f.editor.type === "score" ? 100 : undefined}
                disabled={pending}
                className={newFieldClass}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}
