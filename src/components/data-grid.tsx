import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A spreadsheet-like table for records with many columns (prospect bases):
 * the header stays on top and the first column stays put while the rest
 * scrolls sideways inside its own box, never the page.
 */
export function DataGrid({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-xl border border-border bg-surface">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

const cellBase = "h-10 border-r border-b border-ink-100 px-3 whitespace-nowrap";

export function GridHead({
  children,
  sticky = false,
  align = "start",
  className,
}: {
  children: ReactNode;
  /** The first column: stays visible while scrolling sideways. */
  sticky?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cx(
        "sticky top-0 h-9 border-r border-b border-border bg-ink-50 px-3 text-left font-medium whitespace-nowrap text-ink-700",
        sticky ? "left-0 z-30 shadow-[1px_0_0_var(--color-border)]" : "z-20",
        align === "end" && "text-right",
        className,
      )}
    >
      {children}
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
  sticky?: boolean;
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
          "sticky left-0 z-10 bg-surface font-medium shadow-[1px_0_0_var(--color-border)] group-hover/row:bg-ink-50",
        align === "end" && "text-right tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}
