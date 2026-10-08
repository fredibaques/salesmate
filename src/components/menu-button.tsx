"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./ui";

export type MenuItem = {
  label: ReactNode;
  /** A link (downloads included): plain navigation, so files download as usual. */
  href: string;
  description?: ReactNode;
  icon?: ReactNode;
};

/**
 * A button that opens a short list of choices (e.g. «Exportar» → todo /
 * solo los nuevos). Closes on a click outside, on Escape and on choosing.
 */
export function MenuButton({
  label,
  icon,
  items,
  variant = "secondary",
  size = "md",
  align = "end",
}: {
  label: ReactNode;
  icon?: ReactNode;
  items: MenuItem[];
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonClass({ variant, size })}
      >
        {icon}
        {label}
        <ChevronDown className={cx("transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          role="menu"
          className={cx(
            "absolute top-full z-40 mt-1 w-64 rounded-xl border border-border bg-surface p-1.5 shadow-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, i) => (
            <a
              key={i}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-ink-100 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted"
            >
              {item.icon}
              <span className="min-w-0">
                <span className="block font-medium">{item.label}</span>
                {item.description ? (
                  <span className="block text-xs text-muted">{item.description}</span>
                ) : null}
              </span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
