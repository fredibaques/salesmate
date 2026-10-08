"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalScope } from "./modal";
import { cx } from "./ui";

/**
 * A panel anchored to its trigger (a column header, a «+»), drawn above the
 * page so scrolling boxes don't clip it. Closes on a click outside, on
 * Escape, on scrolling the page, and when a form inside saves (it acts as
 * the forms' modal). `children` may be a function of `close`.
 */
export function Popover({
  trigger,
  triggerClassName,
  triggerLabel,
  children,
  width = "sm",
  align = "start",
}: {
  trigger: ReactNode;
  triggerClassName?: string;
  /** Accessible name when the trigger shows only an icon. */
  triggerLabel?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  width?: "sm" | "md";
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const px = width === "md" ? 384 : 320;

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const left = align === "end" ? r.right - px : r.left;
    // The visible width, without the scrollbar.
    const room = document.documentElement.clientWidth;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, room - px - 8)) });
  }, [open, align, px]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      // Clicks in a dialog opened from inside (a confirm) don't close it.
      if ((t as Element).closest?.("dialog")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = (e: Event) => {
      if (panel.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panel}
              role="dialog"
              style={{ top: pos.top, left: pos.left, width: px }}
              className={cx(
                "fixed z-50 max-h-[min(36rem,calc(100vh-6rem))] overflow-y-auto rounded-xl border border-border bg-surface p-4 text-left text-sm font-normal whitespace-normal text-foreground shadow-lg",
              )}
            >
              <ModalScope close={close}>
                {typeof children === "function" ? children(close) : children}
              </ModalScope>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
