import { Meta, Notice } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { describeNextRun, SCHEDULER_STALE_MS } from "@/server/agents/scheduler";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import type { agentConfigs } from "@/server/db/schema";
import { getProject } from "@/server/services/projects";

/**
 * When a scheduled agent works next, and whether the scheduler is passing:
 * the last time it checked the agent and why a due slot did not run.
 */
export async function ScheduleStatus({
  projectId,
  config,
}: {
  projectId: string;
  config: typeof agentConfigs.$inferSelect;
}) {
  const project = await getProject(getDb(), await requireTenant(), projectId);
  if (!project) return null;
  if (!config.schedule) {
    return <p className="text-sm text-muted">Solo trabaja cuando pulsas «Ejecutar ahora».</p>;
  }
  const now = new Date();
  const working = config.enabled && !project.agentsPaused;
  const next = working
    ? describeNextRun(config.schedule, config.lastScheduledRunAt, now, project.timezone)
    : null;
  const checked = config.scheduleCheckedAt;
  const stale = working && (!checked || now.getTime() - checked.getTime() > SCHEDULER_STALE_MS);

  return (
    <div className="space-y-3">
      <p className="text-sm">
        <Meta
          items={[
            !working ? (
              project.agentsPaused ? (
                "El proyecto está en pausa: no trabajará solo"
              ) : (
                "Desactivado: actívalo para que trabaje solo"
              )
            ) : next ? (
              <span key="next">
                <span className="text-muted">Próxima ejecución:</span> {next}
              </span>
            ) : config.schedule.kind === "once" && config.lastScheduledRunAt ? (
              `Ya trabajó el ${formatDateTime(config.lastScheduledRunAt)}; elige otro momento para repetir`
            ) : (
              "Elige al menos un día"
            ),
            checked ? (
              <span key="checked" className="text-muted">
                programador comprobado {formatDateTime(checked)}
              </span>
            ) : null,
          ]}
        />
      </p>
      {working && config.scheduleNote ? <Notice tone="warning">{config.scheduleNote}</Notice> : null}
      {stale ? (
        <Notice tone="warning">
          {checked
            ? `El programador automático no pasa desde ${formatDateTime(checked)}.`
            : "El programador automático todavía no ha pasado por este agente."}{" "}
          Trabajará en cuanto vuelva a pasar; mientras, puedes lanzarlo a mano desde «Prospectos».
        </Notice>
      ) : null}
    </div>
  );
}
