"use client";

import { Filter } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { OPTION_COLOR_LOOK } from "@/components/option-chip";
import { Popover } from "@/components/popover";
import { optionColor } from "@/lib/prospect-columns";
import { buttonClass, Chip, cx, Field, Input, Segmented } from "@/components/ui";
import {
  filterParam,
  listOf,
  listValue,
  rangeOf,
  rangeValue,
  STATUS_OPTIONS,
  type FilterField,
  type FilterOp,
  type RowFilter,
} from "@/lib/table-filters";

/** Moves to the same table with its filters changed (back to the first page). */
export function useFilterNav(path: string, search: string) {
  const router = useRouter();
  return (change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(search);
    params.delete("page");
    change(params);
    const s = params.toString();
    router.push(s ? `${path}?${s}` : path, { scroll: false });
  };
}

/** Sets (or, with `null`, removes) the filter on one field: a column has at most one. */
export function setFieldFilter(params: URLSearchParams, key: string, filter: RowFilter | null) {
  const rest = params.getAll("f").filter((x) => x.split("~")[0] !== key);
  params.delete("f");
  for (const x of rest) params.append("f", x);
  if (filter) params.append("f", filterParam(filter));
}

/**
 * The funnel next to a column's title: a filter that fits what the column
 * holds — a range of dates or numbers, a tick list for options, yes or no,
 * or text. Faint until hovered; coloured while the column is filtered.
 */
export function ColumnFilter({
  field,
  filter,
  path,
  search,
}: {
  field: FilterField;
  filter?: RowFilter;
  path: string;
  /** The page's current query string, without «?». */
  search: string;
}) {
  const go = useFilterNav(path, search);
  const apply = (next: RowFilter | null) => go((p) => setFieldFilter(p, field.key, next));
  return (
    <Popover
      align="end"
      triggerLabel={filter ? `Cambiar el filtro de «${field.label}»` : `Filtrar por «${field.label}»`}
      triggerClassName={cx(
        "inline-flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-ink-200 hover:text-foreground [&_svg]:size-3.5",
        filter
          ? "bg-brand-50 text-accent"
          : "text-muted opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
      )}
      trigger={<Filter fill={filter ? "currentColor" : "none"} />}
    >
      {(close) => (
        <FilterForm
          field={field}
          filter={filter}
          apply={(next) => {
            apply(next);
            close();
          }}
        />
      )}
    </Popover>
  );
}

/** The ways to filter each kind of field: the first is the usual one. */
function modesFor(type: FilterField["type"]): { op: FilterOp; label: string }[] {
  const presence = [
    { op: "empty" as const, label: "Vacío" },
    { op: "notEmpty" as const, label: "Con valor" },
  ];
  switch (type) {
    case "date":
      return [{ op: "between", label: "Entre fechas" }, ...presence];
    case "number":
    case "score":
      return [{ op: "between", label: "Entre" }, ...presence];
    case "select":
    case "stage":
    case "status":
    case "multi":
      return [{ op: "in", label: "Es alguno de" }, ...presence];
    case "bool":
      return [
        { op: "yes", label: "Sí" },
        { op: "no", label: "No" },
      ];
    default:
      return [{ op: "contains", label: "Contiene" }, { op: "is", label: "Es exactamente" }, ...presence];
  }
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Quick ranges for dates, ending today. */
function datePresets(): { label: string; from: string; to: string }[] {
  const today = new Date();
  const daysAgo = (n: number) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));
  return [
    { label: "Hoy", from: iso(today), to: iso(today) },
    { label: "Últimos 7 días", from: daysAgo(6), to: iso(today) },
    { label: "Últimos 30 días", from: daysAgo(29), to: iso(today) },
    { label: "Este mes", from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) },
  ];
}

function FilterForm({
  field,
  filter,
  apply,
}: {
  field: FilterField;
  filter?: RowFilter;
  apply: (filter: RowFilter | null) => void;
}) {
  const modes = modesFor(field.type);
  // An old filter from a link (gt, before…) opens on the usual mode.
  const initial = modes.find((m) => m.op === filter?.op)?.op ?? modes[0].op;
  const [op, setOp] = useState<FilterOp>(initial);
  const same = filter?.op === op ? filter.value : undefined;
  const [text, setText] = useState(op === "contains" || op === "is" ? (same ?? "") : "");
  const [range, setRange] = useState(rangeOf(op === "between" ? same : undefined));
  const [picked, setPicked] = useState<string[]>(op === "in" ? listOf(same) : []);
  const date = field.type === "date";
  const numeric = field.type === "number" || field.type === "score";
  const options = (field.options ?? []).map((o) => ({
    value: o,
    label: field.type === "status" ? (STATUS_OPTIONS[o] ?? o) : o,
  }));

  const value = (): string | undefined | null => {
    switch (op) {
      case "contains":
      case "is":
        return text.trim() || null;
      case "between":
        return range.from || range.to ? rangeValue(range.from, range.to) : null;
      case "in":
        return picked.length ? listValue(picked) : null;
      default:
        return undefined;
    }
  };
  const next = value();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (next === null) return;
        apply({ key: field.key, op, value: next });
      }}
    >
      <p className="font-semibold">Filtrar por {field.label}</p>
      {modes.length > 1 ? (
        <Segmented
          key={field.key}
          name={`mode-${field.key}`}
          options={modes.map((m) => ({ value: m.op, label: m.label }))}
          defaultValue={op}
          onChange={(v) => setOp(v as FilterOp)}
        />
      ) : null}

      {op === "contains" || op === "is" ? (
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={op === "contains" ? "Texto que contiene" : "Valor exacto"}
          aria-label="Valor"
          autoFocus
        />
      ) : null}

      {op === "between" ? (
        <div className="space-y-2">
          {date ? (
            <div className="flex flex-wrap gap-1.5">
              {datePresets().map((p) => (
                <Chip
                  key={p.label}
                  type="radio"
                  name={`preset-${field.key}`}
                  checked={range.from === p.from && range.to === p.to}
                  onChange={() => setRange({ from: p.from, to: p.to })}
                >
                  {p.label}
                </Chip>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Desde">
              <Input
                type={date ? "date" : "number"}
                step={numeric ? "any" : undefined}
                value={range.from}
                max={date && range.to ? range.to : undefined}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </Field>
            <Field label="Hasta">
              <Input
                type={date ? "date" : "number"}
                step={numeric ? "any" : undefined}
                value={range.to}
                min={date && range.from ? range.from : undefined}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </Field>
          </div>
        </div>
      ) : null}

      {op === "in" ? (
        options.length ? (
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
            {options.map((o) => (
              <Chip
                key={o.value}
                checked={picked.includes(o.value)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, o.value] : p.filter((x) => x !== o.value)))
                }
              >
                {field.type === "status" ? (
                  o.label
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cx(
                        "size-2.5 rounded-full",
                        OPTION_COLOR_LOOK[optionColor(field, o.value)].dot,
                      )}
                    />
                    {o.label}
                  </span>
                )}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Esta columna aún no tiene opciones.</p>
        )
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <button type="submit" disabled={next === null} className={buttonClass({ size: "sm" })}>
          Aplicar
        </button>
        {filter ? (
          <button
            type="button"
            onClick={() => apply(null)}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            Quitar filtro
          </button>
        ) : null}
      </div>
    </form>
  );
}
