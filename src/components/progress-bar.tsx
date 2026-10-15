import type { TaskProgress } from "@/server/agents/tasks";

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
