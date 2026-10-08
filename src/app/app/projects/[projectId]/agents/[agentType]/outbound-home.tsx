import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Card, LinkButton, Meta } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { getAgent, listAgentRuns } from "@/server/services/agents";
import { runProspectingNow } from "../actions";
import { InstructionsCard } from "./instructions-card";
import { RunStatus } from "./run-status";

/** Prospecting agent: what to look for and when, with its latest run alongside. */
export async function OutboundHome({ projectId }: { projectId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, runs, bases] = await Promise.all([
    getAgent(db, tenant, projectId, "outbound"),
    listAgentRuns(db, tenant, projectId, "outbound", 1),
    listBases(db, tenant, projectId),
  ]);
  if (!agent) notFound();
  const last = runs[0];
  const base = bases.find((b) => b.id === agent.config.prospectBaseId) ?? bases[0];
  const pending = base ? await countPendingCells(db, tenant, base.id) : 0;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
      <InstructionsCard projectId={projectId} agentType="outbound" config={agent.config} bases={bases} />
      <Card
        title="Resultados"
        actions={
          base ? (
            <LinkButton href={`/app/projects/${projectId}/prospects/${base.id}`} variant="ghost">
              Abrir la base
            </LinkButton>
          ) : null
        }
      >
        <p className="text-3xl font-semibold tabular-nums">{base?.rows ?? 0}</p>
        <p className="text-sm text-muted">
          filas en «{base?.name ?? "Prospectos"}»{pending ? `, ${pending} celdas por completar` : ""}
        </p>
        <ActionForm
          action={runProspectingNow.bind(null, projectId)}
          submitLabel="Ejecutar ahora"
          submitVariant="secondary"
          className="mt-4 flex flex-wrap items-center gap-3"
        />
        <div className="mt-4 border-t border-border pt-4 text-sm">
          {last ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Última ejecución</span>
                <RunStatus status={last.status} />
              </div>
              <p className="mt-1 text-xs text-muted">
                <Meta
                  items={[
                    formatDateTime(last.startedAt),
                    last.trigger === "schedule" ? "programada" : "manual",
                    last.costUsd ? `${Number(last.costUsd).toFixed(2)} $` : null,
                  ]}
                />
              </p>
              {last.summary || last.error ? (
                <p className="mt-2 text-sm whitespace-pre-wrap text-muted">{last.error ?? last.summary}</p>
              ) : null}
            </>
          ) : (
            <p className="text-muted">
              Todavía no ha trabajado. Lánzalo con «Ejecutar ahora» o elige cuándo trabaja.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
