"use client";

import { Layers, X } from "lucide-react";
import { Select } from "@/components/ui";
import { describeFilter, filterParam, type FilterField, type RowFilter } from "@/lib/table-filters";
import { useFilterNav } from "./column-filter";

/**
 * The filters in use, set from each column's header (all must hold), as
 * chips to remove. They live in the address, so a filtered view can be
 * shared or bookmarked.
 */
export function FilterBar({
  path,
  search,
  fields,
  filters,
}: {
  path: string;
  /** The page's current query string, without «?». */
  search: string;
  fields: FilterField[];
  filters: RowFilter[];
}) {
  const go = useFilterNav(path, search);
  const remove = (f: RowFilter) =>
    go((p) => {
      const rest = p.getAll("f").filter((x) => x !== filterParam(f));
      p.delete("f");
      for (const x of rest) p.append("f", x);
    });
  if (!filters.length) return null;

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
      {filters.length > 1 ? (
        <button
          type="button"
          onClick={() => go((p) => p.delete("f"))}
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:bg-ink-100 hover:text-foreground"
        >
          Quitar filtros
        </button>
      ) : null}
    </div>
  );
}

/** Grouping the rows by one field (?group=), at the table's right edge. */
export function GroupSelect({
  path,
  search,
  fields,
  group,
}: {
  path: string;
  search: string;
  fields: FilterField[];
  group?: string;
}) {
  const go = useFilterNav(path, search);
  const groupable = fields.filter((f) => f.type !== "long" && f.key !== "web");
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted">
      <Layers className="size-3.5 shrink-0" aria-hidden />
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
        className="w-40"
      >
        <option value="">Sin agrupar</option>
        {groupable.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
