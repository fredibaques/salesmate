"use client";

import { Filter, Layers, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Popover } from "@/components/popover";
import { buttonClass, Field, Input, Select } from "@/components/ui";
import {
  describeFilter,
  FILTER_OP_LABELS,
  filterParam,
  NO_VALUE,
  opsFor,
  STATUS_OPTIONS,
  type FilterField,
  type FilterOp,
  type RowFilter,
} from "@/lib/table-filters";

/**
 * Filters on any field (all must hold) and grouping by one, kept in the
 * address so a filtered view can be shared or bookmarked.
 */
export function FilterBar({
  path,
  search,
  fields,
  filters,
  group,
}: {
  path: string;
  /** The page's current query string, without «?». */
  search: string;
  fields: FilterField[];
  filters: RowFilter[];
  group?: string;
}) {
  const router = useRouter();
  const go = (change: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(search);
    params.delete("page");
    change(params);
    const s = params.toString();
    router.push(s ? `${path}?${s}` : path);
  };
  const remove = (f: RowFilter) =>
    go((p) => {
      const rest = p.getAll("f").filter((x) => x !== filterParam(f));
      p.delete("f");
      for (const x of rest) p.append("f", x);
    });
  const groupable = fields.filter((f) => f.type !== "long" && f.key !== "web");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <span
          key={filterParam(f)}
          className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-brand-50 py-0.5 pr-1 pl-3 text-xs"
        >
          {describeFilter(f, fields)}
          <button
            type="button"
            onClick={() => remove(f)}
            aria-label={`Quitar el filtro ${describeFilter(f, fields)}`}
            className="rounded-full p-0.5 text-muted transition-colors hover:bg-ink-100 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <Popover
        trigger={
          <>
            <Filter className="size-3.5" />
            Filtrar
          </>
        }
        triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
      >
        {(close) => (
          <AddFilter
            fields={fields}
            add={(f) => {
              go((p) => p.append("f", filterParam(f)));
              close();
            }}
          />
        )}
      </Popover>
      <label className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Layers className="size-3.5" aria-hidden />
        <span className="sr-only">Agrupar por</span>
        <Select
          size="sm"
          value={group ?? ""}
          onChange={(e) =>
            go((p) => {
              if (e.target.value) p.set("group", e.target.value);
              else p.delete("group");
            })
          }
          aria-label="Agrupar por"
          className="w-auto min-w-36"
        >
          <option value="">Sin agrupar</option>
          {groupable.map((f) => (
            <option key={f.key} value={f.key}>
              Agrupar por {f.label}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

/** Choosing a field, a condition and (if it takes one) a value. */
function AddFilter({ fields, add }: { fields: FilterField[]; add: (f: RowFilter) => void }) {
  const [key, setKey] = useState(fields[0]?.key ?? "");
  const field = fields.find((f) => f.key === key) ?? fields[0];
  const ops = opsFor(field.type);
  const [op, setOp] = useState<FilterOp>(ops[0]);
  const currentOp = ops.includes(op) ? op : ops[0];
  const [value, setValue] = useState("");
  const needsValue = !NO_VALUE.includes(currentOp);
  const options =
    field.type === "status"
      ? (field.options ?? []).map((o) => ({ value: o, label: STATUS_OPTIONS[o] ?? o }))
      : (field.options ?? []).map((o) => ({ value: o, label: o }));
  const choose = options.length > 0 && (currentOp === "is" || currentOp === "isNot" || currentOp === "has");

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (needsValue && !value.trim()) return;
        add({ key: field.key, op: currentOp, value: needsValue ? value.trim() : undefined });
      }}
    >
      <Field label="Campo">
        <Select
          value={field.key}
          onChange={(e) => {
            setKey(e.target.value);
            setValue("");
          }}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Condición">
        <Select value={currentOp} onChange={(e) => setOp(e.target.value as FilterOp)}>
          {ops.map((o) => (
            <option key={o} value={o}>
              {FILTER_OP_LABELS[o]}
            </option>
          ))}
        </Select>
      </Field>
      {needsValue ? (
        <Field label="Valor">
          {choose ? (
            <Select value={value} onChange={(e) => setValue(e.target.value)} required>
              <option value="" disabled>
                Elige…
              </option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              type={
                field.type === "date"
                  ? "date"
                  : field.type === "number" || field.type === "score"
                    ? "number"
                    : "text"
              }
              step="any"
              autoFocus
            />
          )}
        </Field>
      ) : null}
      <button type="submit" className={buttonClass({ size: "sm" })}>
        Aplicar filtro
      </button>
    </form>
  );
}
