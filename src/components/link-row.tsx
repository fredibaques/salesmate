"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { cx } from "./cx";

/**
 * A table row that opens `href` when clicked anywhere. The row's first cell
 * should still hold a real link (keyboard, middle click, screen readers).
 * Not a link stretched over the row: Safari ignores `position: relative` on
 * table rows, so every row's overlay would cover the whole table.
 */
export function LinkRow({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const open = (e: MouseEvent<HTMLTableRowElement>) => {
    // Links, buttons and fields inside the row do their own thing.
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  return (
    <tr onClick={open} className={cx("group cursor-pointer transition-colors hover:bg-ink-25", className)}>
      {children}
    </tr>
  );
}
