"use client";

import { Settings } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ModalButton } from "@/components/modal";
import { cx } from "@/components/ui";

/**
 * «Configuración» at the top right of an agent: how it works (its goal,
 * when it works, model, notices…) and what it may do without asking, as two
 * views of one modal. Each view saves on its own. ?config=1 (or
 * ?config=approvals) opens it on arrival.
 */
export function AgentConfigModal({ setup, approvals }: { setup: ReactNode; approvals: ReactNode }) {
  const asked = useSearchParams().get("config");
  const [view, setView] = useState<"setup" | "approvals">(asked === "approvals" ? "approvals" : "setup");
  return (
    <ModalButton
      label="Configuración"
      icon={<Settings className="size-4" />}
      title="Configuración del agente"
      variant="secondary"
      width="xl"
      defaultOpen={Boolean(asked)}
    >
      <div className="space-y-5">
        <div role="tablist" className="flex gap-1 rounded-lg bg-ink-50 p-1 text-sm">
          {(
            [
              ["setup", "Cómo trabaja"],
              ["approvals", "Aprobaciones"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cx(
                "flex-1 rounded-md px-3 py-1.5 transition-colors",
                view === key ? "bg-surface font-medium shadow-xs" : "text-ink-700 hover:bg-ink-100",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Both stay mounted, so what is typed in one isn't lost by looking at the other. */}
        <div hidden={view !== "setup"}>{setup}</div>
        <div hidden={view !== "approvals"}>{approvals}</div>
      </div>
    </ModalButton>
  );
}
