"use client";

import { Check, ExternalLink, Network, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { FormState } from "@/components/action-form";
import { Popover } from "@/components/popover";
import { useToast } from "@/components/toast";
import { buttonClass, cx, Input } from "@/components/ui";

/**
 * Picking the row of another table a row belongs to (a person's company):
 * a search by name over the linked table, in a cell of the table or a field
 * of the row panel.
 */

export type LinkOption = { id: string; seq: number; name: string; detail: string | null };
export type SearchRows = (q: string) => Promise<LinkOption[]>;
/** The row it points at now, if any. */
export type LinkValue = { id: string; name: string } | null;

const optionClass =
  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-ink-100";

/** A search box and the closest rows of the linked table; picking one (or none) calls `onPick`. */
function RowSearch({
  search,
  current,
  onPick,
  tableName,
}: {
  search: SearchRows;
  current: string | null;
  onPick: (row: LinkValue) => void;
  tableName: string;
}) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<LinkOption[] | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () => {
        search(q)
          .then((rows) => live && setOptions(rows))
          .catch(() => live && setOptions([]));
      },
      q ? 200 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, search]);
  return (
    <div className="space-y-2">
      <Input
        autoFocus
        size="sm"
        icon={<Search />}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Buscar en «${tableName}»`}
        aria-label={`Buscar en «${tableName}»`}
      />
      <div className="-mx-2 max-h-72 space-y-0.5 overflow-y-auto">
        {options === null ? (
          <p className="px-2 py-1.5 text-sm text-muted">Buscando…</p>
        ) : options.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted">
            {q ? "Nada coincide." : `«${tableName}» no tiene filas todavía.`}
          </p>
        ) : (
          options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick({ id: o.id, name: o.name })}
              className={optionClass}
            >
              <span className="w-8 shrink-0 text-right text-xs text-muted tabular-nums">{o.seq}</span>
              <span className="min-w-0 flex-1 truncate">
                {o.name}
                {o.detail ? <span className="text-muted"> · {o.detail}</span> : null}
              </span>
              {o.id === current ? <Check className="size-4 shrink-0 text-accent" /> : null}
            </button>
          ))
        )}
      </div>
      {current ? (
        <button
          type="button"
          onClick={() => onPick(null)}
          className={cx(optionClass, "-mx-2 w-[calc(100%+1rem)] border-t border-border text-muted")}
        >
          <X className="size-4" />
          Quitar la relación
        </button>
      ) : null}
    </div>
  );
}

/** The name of the row it points at, as a tag. */
function LinkTag({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-ink-100 px-1.5 py-0.5 text-sm">
      <Network className="size-3 shrink-0 text-muted" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A relation cell of the table: the linked row's name; a click picks another one. */
export function LinkCell({
  rowId,
  field,
  value,
  save,
  search,
  label,
  tableName,
  targetPath,
  canEdit = true,
}: {
  rowId: string;
  field: string;
  value: LinkValue;
  save: (rowId: string, key: string, value: string | null) => Promise<FormState>;
  search: SearchRows;
  /** What the cell is, for screen readers: «Empresa de Ana Ruiz». */
  label: string;
  /** The linked table. */
  tableName: string;
  /** Where the linked table is (its rows open with ?row=). */
  targetPath: string;
  canEdit?: boolean;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<LinkValue | undefined>(undefined);
  const [pending, start] = useTransition();
  const shown = draft === undefined ? value : draft;

  if (!canEdit) {
    return shown ? (
      <Link href={`${targetPath}?row=${shown.id}`} className="hover:underline">
        <LinkTag name={shown.name} />
      </Link>
    ) : null;
  }

  const pick = (next: LinkValue) => {
    if ((next?.id ?? null) === (value?.id ?? null)) return;
    setDraft(next);
    start(async () => {
      const result = await save(rowId, field, next?.id ?? null);
      if (!result?.ok) toast?.({ ok: false, message: result?.message ?? "No se ha podido guardar." });
      setDraft(undefined);
    });
  };

  return (
    <Popover
      triggerLabel={`Editar ${label}`}
      triggerClassName={cx(
        "-mx-3 flex h-10 w-[calc(100%+1.5rem)] min-w-24 items-center px-3 text-left hover:bg-ink-50",
        pending && "opacity-60",
      )}
      trigger={shown ? <LinkTag name={shown.name} /> : null}
    >
      {(close) => (
        <div className="space-y-2">
          {shown ? (
            <Link
              href={`${targetPath}?row=${shown.id}`}
              onClick={close}
              className="flex items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Abrir «{shown.name}»
            </Link>
          ) : null}
          <RowSearch
            search={search}
            current={shown?.id ?? null}
            tableName={tableName}
            onPick={(row) => {
              close();
              pick(row);
            }}
          />
        </div>
      )}
    </Popover>
  );
}

/** The relation in the row panel's form: a hidden input (`name`) with the picked row's id. */
export function LinkField({
  name,
  defaultValue,
  search,
  tableName,
  targetPath,
}: {
  name: string;
  defaultValue: LinkValue;
  search: SearchRows;
  tableName: string;
  targetPath: string;
}) {
  const [value, setValue] = useState<LinkValue>(defaultValue);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="hidden" name={name} value={value?.id ?? ""} />
      {value ? (
        <Link href={`${targetPath}?row=${value.id}`} className="min-w-0 hover:underline">
          <LinkTag name={value.name} />
        </Link>
      ) : (
        <span className="text-sm text-muted">Sin relacionar</span>
      )}
      <Popover
        triggerLabel={value ? "Cambiar" : `Elegir en «${tableName}»`}
        triggerClassName={buttonClass({ variant: "secondary", size: "sm" })}
        trigger={value ? "Cambiar" : `Elegir en «${tableName}»`}
      >
        {(close) => (
          <RowSearch
            search={search}
            current={value?.id ?? null}
            tableName={tableName}
            onPick={(row) => {
              close();
              setValue(row);
            }}
          />
        )}
      </Popover>
    </div>
  );
}
