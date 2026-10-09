import { ChevronRight, Clock, ListTree } from "lucide-react";
import Link from "next/link";
import { AgentTile } from "@/components/agent-look-fields";
import { Drawer } from "@/components/drawer";
import { RichText } from "@/components/rich-text";
import { cx, EmptyState, LinkButton } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { RunLogRow } from "@/server/agents/runs";
import type { AgentRunStep } from "@/server/db/schema";
import { RunStatus } from "./run-status";

/**
 * The agents' runs as a log: one line each (when, what started it, how it
 * ended, how long, how much) that opens to its summary and what it cost,
 * item by item. Its steps open in a side panel.
 */

const TRIGGERS: Record<string, string> = {
  manual: "A mano",
  schedule: "Programada",
  event: "Por un aviso",
  inbound_event: "Mensaje recibido",
  copilot: "Copilot",
};

export const usd = (v: number) => `${v < 0.01 && v > 0 ? v.toFixed(4) : v.toFixed(2)} $`;

function duration(ms: number | null) {
  if (ms === null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function RunLog({
  runs,
  showAgent,
  stepsHref,
  moreHref,
}: {
  runs: RunLogRow[];
  /** Which agent ran (the whole organization's log). */
  showAgent: boolean;
  stepsHref: (runId: string) => string;
  /** The next page, when there is one. */
  moreHref: string | null;
}) {
  if (!runs.length) {
    return (
      <EmptyState
        compact
        icon={<Clock />}
        title="Todavía no hay ejecuciones"
        description="Cada vez que un agente trabaje (a mano, con su horario o por un aviso) quedará aquí, con lo que hizo y lo que costó."
      />
    );
  }
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {runs.map((r) => (
          <li key={r.id}>
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-ink-50 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
                {showAgent ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <AgentTile type={r.agentType} icon={r.icon} color={r.color} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.label}</span>
                      <span className="block truncate text-xs text-muted">{r.projectName}</span>
                    </span>
                  </span>
                ) : null}
                <span className={cx("min-w-0", showAgent ? "hidden w-36 sm:block" : "flex-1")}>
                  <span className="block">{formatDateTime(r.startedAt)}</span>
                  <span className="block text-xs text-muted">{TRIGGERS[r.trigger] ?? r.trigger}</span>
                </span>
                <span className="hidden w-28 md:block">
                  <RunStatus status={r.status} />
                </span>
                <span className="hidden w-20 text-right text-muted tabular-nums md:block">
                  {duration(r.durationMs)}
                </span>
                <span className="w-20 text-right font-medium whitespace-nowrap tabular-nums">
                  {usd(r.costUsd)}
                </span>
              </summary>
              <div className="grid gap-5 border-t border-border bg-ink-25 px-4 py-4 lg:grid-cols-[1fr_20rem]">
                <div className="min-w-0 space-y-2 text-sm">
                  <span className="md:hidden">
                    <RunStatus status={r.status} />
                  </span>
                  {r.error ? <p className="text-danger">{r.error}</p> : null}
                  {r.summary ? (
                    <RichText text={r.summary} />
                  ) : !r.error ? (
                    <p className="text-muted">{r.status === "running" ? "Trabajando…" : "Sin resumen."}</p>
                  ) : null}
                  {r.steps ? (
                    <Link
                      href={stepsHref(r.id)}
                      scroll={false}
                      className="inline-flex items-center gap-1.5 text-accent hover:underline"
                    >
                      <ListTree className="size-4" />
                      Ver sus {r.steps} pasos
                    </Link>
                  ) : null}
                </div>
                <div className="text-sm">
                  <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Coste</p>
                  <table className="w-full">
                    <tbody className="divide-y divide-border">
                      {r.cost.map((line) => (
                        <tr key={line.key}>
                          <td className="py-1.5 pr-2">
                            {line.label}
                            <span className="block text-xs text-muted">{line.detail}</span>
                          </td>
                          <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums">
                            {usd(line.usd)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-medium">
                        <td className="py-1.5">Total</td>
                        <td className="py-1.5 pl-3 text-right whitespace-nowrap tabular-nums">
                          {usd(r.costUsd)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">
                    Modelo {r.model} · {duration(r.durationMs)}
                  </p>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
      {moreHref ? (
        <div className="flex justify-center">
          <LinkButton href={moreHref} variant="ghost">
            Ver más antiguas
          </LinkButton>
        </div>
      ) : null}
    </div>
  );
}

/** A run's steps in the side panel: what the agent said, the tools it used and what they gave back. */
export function RunSteps({
  run,
  closeHref,
}: {
  run: { id: string; startedAt: Date; steps: AgentRunStep[]; costUsd: number };
  closeHref: string;
}) {
  return (
    <Drawer
      title="Pasos de la ejecución"
      subtitle={`${formatDateTime(run.startedAt)} · ${usd(run.costUsd)}`}
      icon={<ListTree />}
      closeHref={closeHref}
    >
      <ol className="space-y-2 text-sm">
        {run.steps.map((step, i) => (
          <li
            key={i}
            className={cx(
              "rounded-lg px-3 py-2",
              step.type === "text"
                ? "bg-surface"
                : step.type === "tool_result" && step.isError
                  ? "bg-coral-50 text-danger"
                  : "bg-ink-50 font-mono text-xs text-ink-700",
            )}
          >
            {step.type === "text" ? (
              <RichText text={step.text} />
            ) : step.type === "tool_call" ? (
              <span className="break-all">
                → {step.name}({JSON.stringify(step.input).slice(0, 400)})
              </span>
            ) : (
              <span className="break-all">
                ← {step.name}: {JSON.stringify(step.output).slice(0, 400)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </Drawer>
  );
}
