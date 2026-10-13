import Link from "next/link";
import { CalendarClock, Loader2 } from "lucide-react";
import { Meta } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { AgentTask, TaskProgress } from "@/server/agents/tasks";
import { usd } from "@/app/app/(settings)/runs/run-log";

/** «45 de 120 filas», with a bar. */
export function ProgressBar({ progress, live = false }: { progress: TaskProgress; live?: boolean }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-label={`${progress.done} de ${progress.total} ${progress.unit}`}
        className="h-2 overflow-hidden rounded-full bg-ink-100"
      >
        <div
          className={
            live
              ? "h-full rounded-full bg-brand-500 transition-[width] duration-700"
              : "h-full rounded-full bg-ink-400"
          }
          style={{ width: `${Math.max(pct, progress.done > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="text-xs text-muted tabular-nums">
        {progress.done} de {progress.total} {progress.unit} · {pct} %
      </p>
    </div>
  );
}

function minutesSince(date: Date) {
  const min = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return min < 1 ? "hace menos de un minuto" : min === 1 ? "hace 1 minuto" : `hace ${min} minutos`;
}

/** What the agent is doing now, with how far along each request is. */
export function RunningTasks({
  tasks,
  stepsHref,
}: {
  tasks: AgentTask[];
  stepsHref: (runId: string) => string;
}) {
  if (!tasks.length) return <p className="text-sm text-muted">No está trabajando ahora.</p>;
  return (
    <ul className="space-y-4">
      {tasks.map((t) => (
        <li key={t.key} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="size-4 shrink-0 animate-spin text-brand-600" aria-hidden />
              {t.title}
            </p>
            {t.runId ? (
              <Link
                href={stepsHref(t.runId)}
                scroll={false}
                className="shrink-0 text-sm text-accent hover:underline"
              >
                Ver pasos
              </Link>
            ) : null}
          </div>
          {t.progress ? <ProgressBar progress={t.progress} live /> : null}
          <p className="text-xs text-muted">
            <Meta
              items={[
                t.startedAt ? `Empezó ${minutesSince(t.startedAt)} (${formatDateTime(t.startedAt)})` : null,
                t.costUsd ? `${usd(t.costUsd)} hasta ahora` : null,
              ]}
            />
          </p>
        </li>
      ))}
    </ul>
  );
}

/** What it will do next, in order. */
export function PlannedTasks({ tasks }: { tasks: AgentTask[] }) {
  if (!tasks.length) return <p className="text-sm text-muted">Nada planificado.</p>;
  return (
    <ul className="divide-y divide-border">
      {tasks.map((t) => (
        <li key={t.key} className="space-y-2 py-3 first:pt-0 last:pb-0">
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-2 font-medium">
              <CalendarClock className="size-4 shrink-0 text-muted" aria-hidden />
              {t.title}
            </p>
            <span className="shrink-0 text-sm text-muted first-letter:uppercase">{t.when}</span>
          </div>
          {t.progress ? <ProgressBar progress={t.progress} /> : null}
        </li>
      ))}
    </ul>
  );
}
