import Link from "next/link";
import { Card, LinkButton } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { firstEmailsWaiting, getAgent } from "@/server/services/agents";

/** The prospecting agent's table at a glance. */
export async function ResultsCard({ projectId }: { projectId: string }) {
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, bases] = await Promise.all([
    getAgent(db, tenant, projectId, "outbound"),
    listBases(db, tenant, projectId, { standalone: true }),
  ]);
  const base = bases.find((b) => b.id === agent?.config.prospectBaseId) ?? bases[0];
  const [pending, waiting] = await Promise.all([
    base ? countPendingCells(db, tenant, base.id) : 0,
    firstEmailsWaiting(db, tenant, projectId),
  ]);
  return (
    <Card
      title="Resultados"
      actions={
        base ? (
          <LinkButton href={`/app/tables/${base.id}`} variant="ghost">
            Abrir la tabla
          </LinkButton>
        ) : null
      }
    >
      <p className="text-3xl font-semibold tabular-nums">{base?.rows ?? 0}</p>
      <p className="text-sm text-muted">
        filas en «{base?.name ?? "Prospectos"}»{pending ? `, ${pending} celdas por completar` : ""}
      </p>
      {waiting ? (
        <p className="mt-2 text-sm">
          <Link href="/app/inbox" className="text-accent hover:underline">
            {waiting === 1 ? "1 primer email espera" : `${waiting} primeros emails esperan`} tu aprobación
          </Link>
        </p>
      ) : null}
    </Card>
  );
}
