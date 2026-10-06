"use client";

import { useFormStatus } from "react-dom";
import { cx } from "./ui";

/**
 * On/off control for something that can be switched on (an agent, a
 * project). Put it inside a <form> whose action flips the state.
 */
export function SwitchButton({
  on,
  onLabel = "Activo",
  offLabel = "Inactivo",
  label,
}: {
  on: boolean;
  onLabel?: string;
  offLabel?: string;
  /** Accessible name, e.g. «Activar el agente inbound». */
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={pending}
      className="group/switch inline-flex items-center gap-2 rounded-full py-1 pr-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
    >
      <span
        className={cx(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
          on ? "bg-leaf-500 group-hover/switch:bg-leaf-700" : "bg-ink-300 group-hover/switch:bg-ink-400",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
            on ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
      <span className={on ? "text-success" : "text-muted"}>{pending ? "…" : on ? onLabel : offLabel}</span>
    </button>
  );
}
