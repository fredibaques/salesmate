"use client";

import { useRef } from "react";

export type DropTarget = { id: string; side: "before" | "after" };

/** How long a press lasts before it picks the column up. */
const HOLD_MS = 280;
/** A finger that moves this much before that is scrolling, not dragging. */
const SLOP = 8;

/**
 * Reordering columns by dragging their header: press and hold (or, with a
 * mouse, just drag) and drop it on another header. The headers that take a
 * drop carry `data-drop-column`; the one under the pointer gets `data-drop`
 * (before / after) to show where it lands. Works with mouse and touch.
 */
export function useColumnDrag(id: string, label: string, onDrop: (target: DropTarget) => void) {
  const suppressClick = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const origin = e.currentTarget.closest<HTMLElement>("th");
    if (!origin) return;
    const scroller = origin.closest<HTMLElement>("[data-grid-scroll]");
    const touch = e.pointerType !== "mouse";
    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let active = false;
    let target: DropTarget | null = null;
    let marked: HTMLElement | null = null;
    let ghost: HTMLElement | null = null;

    const place = (x: number, y: number) => {
      if (ghost) ghost.style.transform = `translate(${x + 10}px, ${y + 10}px)`;
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        if (x < box.left + 48) scroller.scrollLeft -= 18;
        else if (x > box.right - 48) scroller.scrollLeft += 18;
      }
      const over = document
        .elementsFromPoint(x, y)
        .find((el): el is HTMLElement => el instanceof HTMLElement && Boolean(el.dataset.dropColumn));
      if (marked && marked !== over) delete marked.dataset.drop;
      marked = null;
      target = null;
      if (!over || over.dataset.dropColumn === id) return;
      const box = over.getBoundingClientRect();
      const side = x < box.left + box.width / 2 ? "before" : "after";
      over.dataset.drop = side;
      marked = over;
      target = { id: over.dataset.dropColumn!, side };
    };

    const begin = () => {
      active = true;
      navigator.vibrate?.(10);
      origin.dataset.dragging = "true";
      ghost = document.createElement("div");
      ghost.textContent = label;
      ghost.className =
        "pointer-events-none fixed top-0 left-0 z-[60] rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium shadow-lg";
      document.body.appendChild(ghost);
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      place(last.x, last.y);
    };

    const timer = window.setTimeout(begin, HOLD_MS);

    const move = (ev: PointerEvent) => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        if (Math.hypot(last.x - start.x, last.y - start.y) < SLOP) return;
        // A finger moving before the hold scrolls; a mouse moving drags.
        if (touch) return cleanup();
        begin();
      }
      place(last.x, last.y);
    };
    const up = () => {
      const dropped = active ? target : null;
      if (active) suppressClick.current = true;
      cleanup();
      if (dropped) onDrop(dropped);
    };
    // While dragging, the finger moves the column, not the page.
    const blockScroll = (ev: TouchEvent) => {
      if (active) ev.preventDefault();
    };

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cleanup);
      document.removeEventListener("touchmove", blockScroll);
      ghost?.remove();
      if (marked) delete marked.dataset.drop;
      delete origin!.dataset.dragging;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cleanup);
    document.addEventListener("touchmove", blockScroll, { passive: false });
  };

  return {
    onPointerDown,
    // The click that ends a drag doesn't open the column's menu.
    onClickCapture: (e: React.MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu: (e: React.MouseEvent) => {
      if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType !== "mouse") e.preventDefault();
    },
  };
}
