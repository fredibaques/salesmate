import { Building2, Database, Plus, User } from "lucide-react";
import { CardGrid, EmptyState, EntityCard, LinkButton, Meta, Toolbar } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { formatDateTime, plural } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";

export const metadata = { title: "Prospectos" };

/** The project's prospect bases: tables of companies or people that agents fill and people review. */
export default async function ProspectBasesPage({
  params,
}: PageProps<"/app/projects/[projectId]/prospects">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const bases = await listBases(db, tenant, projectId);
  // Cells left to fill, only where an agent fills the base.
  const pending = await Promise.all(
    bases.map((b) => (b.agents.length ? countPendingCells(db, tenant, b.id) : Promise.resolve(0))),
  );
  const path = `/app/projects/${projectId}/prospects`;
  const canEdit = tenant.role !== "member";
  const newBase = canEdit ? (
    <LinkButton href={`${path}/new`} variant={bases.length ? "primary" : "secondary"}>
      <Plus />
      Nueva base
    </LinkButton>
  ) : null;

  if (bases.length === 0) {
    return (
      <EmptyState
        icon={<Database />}
        title="Todavía no hay bases de prospectos"
        description="Una base es una tabla de empresas o personas con las columnas que tú decides. El agente de prospección la rellena y tu equipo la revisa y la exporta."
        action={
          <>
            {canEdit ? (
              <LinkButton href={`/app/projects/${projectId}/agents/new/outbound`} variant="primary">
                Añadir el agente de prospección
              </LinkButton>
            ) : null}
            {newBase}
          </>
        }
      />
    );
  }

  return (
    <>
      <Toolbar>{newBase}</Toolbar>
      <CardGrid>
        {bases.map((b, i) => (
          <EntityCard
            key={b.id}
            href={`${path}/${b.id}`}
            icon={b.rowKind === "person" ? <User /> : <Building2 />}
            title={b.name}
            meta={
              <Meta
                items={[
                  b.rowKind === "person" ? "Personas" : "Empresas",
                  plural(b.rows, "fila", "filas"),
                  plural(b.columns.length, "columna", "columnas"),
                  pending[i] ? `${pending[i]} por completar` : null,
                  `actualizada ${formatDateTime(b.updatedAt)}`,
                ]}
              />
            }
            description={
              b.agents.length
                ? `La rellena: ${b.agents.map((a) => AGENT_INFO[a as keyof typeof AGENT_INFO]?.name ?? a).join(", ")}`
                : "Ningún agente la rellena"
            }
          />
        ))}
      </CardGrid>
    </>
  );
}
