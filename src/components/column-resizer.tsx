"use client";

import type { PointerEvent } from "react";

/**
 * The grab handle on a header's right edge: dragging it makes the column
 * wider or narrower (its `<col data-col>` and the table follow the pointer),
 * and letting go saves the width.
 */
export function ColumnResizer({
  colKey,
  min = 60,
  max = 800,
  save,
}: {
  colKey: string;
  min?: number;
  max?: number;
  save: (key: string, width: number) => Promise<void>;
}) {
  const start = (e: PointerEvent<HTMLSpanElement>) => {
    // Not a click on the header, nor the start of dragging the column.
    e.preventDefault();
    e.stopPropagation();
    const table = e.currentTarget.closest("table");
    const col = table?.querySelector<HTMLTableColElement>(`col[data-col="${CSS.escape(colKey)}"]`);
    if (!table || !col) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = col.getBoundingClientRect().width;
    let width = startWidth;
    const total = () =>
      [...table.querySelectorAll<HTMLTableColElement>("col[data-col]")].reduce(
        (n, c) => n + (parseFloat(c.style.width) || 0),
        0,
      );
    const move = (ev: globalThis.PointerEvent) => {
      width = Math.round(Math.min(max, Math.max(min, startWidth + ev.clientX - startX)));
      col.style.width = `${width}px`;
      table.style.width = `${total()}px`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      document.body.style.cursor = "";
      if (width !== Math.round(startWidth)) void save(colKey, width);
    };
    document.body.style.cursor = "col-resize";
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Cambiar el ancho de la columna"
      title="Arrastra para cambiar el ancho"
      onPointerDown={start}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-1.5 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent after:transition-colors hover:after:bg-accent"
    />
  );
}
