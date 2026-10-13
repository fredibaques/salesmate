import type { ReactNode } from "react";
import { ColumnResizer } from "./column-resizer";
import { cx } from "./cx";

/** A column's width in pixels, by its key (the same key `GridHead` resizes). */
export type GridColumn = { key: string; width: number };

/**
 * A spreadsheet-like table for records with many columns (prospect bases):
 * the header stays on top and the first column stays put while the rest
 * scrolls sideways inside its own box, never the page.
 */
export function DataGrid({
  head,
  children,
  columns,
}: {
  head: ReactNode;
  children: ReactNode;
  /** Fixed widths, in the order of the columns: long values are cut and the columns can be resized. */
  columns?: GridColumn[];
}) {
  const total = columns?.reduce((n, c) => n + c.width, 0);
  return (
    <div
      data-grid-scroll
      className="max-h-[calc(100dvh-15rem)] min-h-48 overflow-auto rounded-xl border border-border bg-surface"
    >
      <table
        className={cx("min-w-full border-separate border-spacing-0 text-sm", columns && "table-fixed")}
        style={total ? { width: total } : undefined}
      >
        {columns ? (
          <colgroup>
            {columns.map((c) => (
              <col key={c.key} data-col={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const cellBase = "h-10 overflow-hidden border-r border-b border-ink-100 px-3 text-ellipsis whitespace-nowrap";

/** Width of a narrow first column (the row's ID) that the second sticky column sits after. */
export const NARROW_COLUMN = "w-14 min-w-14 max-w-14";

/** Where a sticky column sits: at the edge, or after the narrow first column. */
export function stickyLeft(sticky: true | "second") {
  return sticky === "second" ? "left-14" : "left-0";
}

export function GridHead({
  children,
  sticky = false,
  align = "start",
  dropId,
  resize,
  className,
}: {
  children: ReactNode;
  /** A column that others can be dropped next to (dragging headers). */
  dropId?: string;
  /** Its key in `DataGrid`'s columns and where to save a new width: shows the handle to resize it. */
  resize?: { key: string; save: (key: string, width: number) => Promise<void> };
  /** Stays visible while scrolling sideways: the first column, or "second" right after a narrow first one. */
  sticky?: boolean | "second";
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <th
      scope="col"
      data-drop-column={dropId}
      className={cx(
        "group/head sticky top-0 h-9 overflow-hidden border-r border-b border-border bg-ink-50 px-3 text-left font-medium text-ellipsis whitespace-nowrap text-ink-700",
        "data-[dragging=true]:opacity-40 data-[drop=after]:shadow-[inset_-3px_0_0_var(--color-accent)] data-[drop=before]:shadow-[inset_3px_0_0_var(--color-accent)]",
        sticky ? cx(stickyLeft(sticky), "z-30 shadow-[1px_0_0_var(--color-border)]") : "z-20",
        align === "end" && "text-right",
        className,
      )}
    >
      {children}
      {resize ? <ColumnResizer colKey={resize.key} save={resize.save} /> : null}
    </th>
  );
}

export function GridRow({ children }: { children: ReactNode }) {
  return <tr className="group/row">{children}</tr>;
}

export function GridCell({
  children,
  sticky = false,
  align = "start",
  title,
  className,
}: {
  children?: ReactNode;
  sticky?: boolean | "second";
  align?: "start" | "end";
  title?: string;
  className?: string;
}) {
  return (
    <td
      title={title}
      className={cx(
        cellBase,
        "group-hover/row:bg-ink-25",
        sticky &&
          cx(
            "sticky z-10 bg-surface font-medium shadow-[1px_0_0_var(--color-border)] group-hover/row:bg-ink-50",
            stickyLeft(sticky),
          ),
        align === "end" && "text-right tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}
