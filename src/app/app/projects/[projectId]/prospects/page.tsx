import { Building2, Database, User } from "lucide-react";
import { redirect } from "next/navigation";
import { CardGrid, EmptyState, EntityCard, LinkButton, Meta } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listBases } from "@/server/prospects/bases";

export const metadata = { title: "Prospectos" };

/** The project's prospect bases. With only one, it opens directly. */
export default async function ProspectBasesPage({
  params,
}: PageProps<"/app/projects/[projectId]/prospects">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const bases = await listBases(getDb(), tenant, projectId);
  const path = `/app/projects/${projectId}/prospects`;
  if (bases.length === 1) redirect(`${path}/${bases[0].id}`);

  if (bases.length === 0) {
    return (
      <EmptyState
        icon={<Database />}
        title="Todavía no hay bases de prospectos"
        description="Las crea el agente de prospección al añadirlo: busca empresas que encajan con tu cliente ideal y las guarda aquí, con las columnas que quieras."
        action={
          <LinkButton href={`/app/projects/${projectId}/agents/new/outbound`} variant="primary">
            Añadir el agente de prospección
          </LinkButton>
        }
      />
    );
  }

  return (
    <CardGrid>
      {bases.map((b) => (
        <EntityCard
          key={b.id}
          href={`${path}/${b.id}`}
          icon={b.rowKind === "person" ? <User /> : <Building2 />}
          title={b.name}
          meta={
            <Meta
              items={[
                b.rowKind === "person" ? "Personas" : "Empresas",
                `${b.rows} filas`,
                `${b.columns.length} columnas`,
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
  );
}
