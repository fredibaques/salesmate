import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A short explanation that appears on hover or keyboard focus. CSS only, so
 * it works in server components. Use it for how-to hints instead of
 * paragraphs under titles.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  className,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <span className={cx("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cx(
          "pointer-events-none invisible absolute z-50 w-max max-w-72 rounded-lg bg-foreground px-3 py-2",
          "text-left text-xs leading-relaxed font-normal tracking-normal whitespace-normal normal-case text-background",
          "opacity-0 shadow-lg transition-opacity duration-150",
          "group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-150",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          align === "center" && "left-1/2 -translate-x-1/2",
          align === "start" && "left-0",
          align === "end" && "right-0",
        )}
      >
        {content}
      </span>
    </span>
  );
}

/**
 * A «?» next to a title or a label that explains how something works. It is
 * a focusable span, not a button, so it can sit inside a <label>.
 */
export function InfoTip({
  children,
  label = "Más información",
  side = "bottom",
  align = "center",
}: {
  children: ReactNode;
  label?: string;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}) {
  return (
    <Tooltip content={children} side={side} align={align}>
      <span
        tabIndex={0}
        role="img"
        aria-label={label}
        className="inline-flex size-5 cursor-help items-center justify-center rounded-full text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        <CircleHelp className="size-4" />
      </span>
    </Tooltip>
  );
}
