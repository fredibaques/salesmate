import { Building2, Sheet, User } from "lucide-react";
import Link from "next/link";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { formatDateTime, plural } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listAllBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { listProjects } from "@/server/services/projects";
import { NewTableButton } from "../projects/[projectId]/prospects/new/new-table-button";
import { NewProjectButton } from "../projects/new-project";

export const metadata = { title: "Tablas" };

/**
 * Every table of the organization, from all its projects: the prospect
 * bases its agents fill. The quickest way to what the agents produce.
 */
export default async function TablesPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [bases, projects] = await Promise.all([listAllBases(db, tenant), listProjects(db, tenant)]);
  const pending = await Promise.all(
    bases.map((b) => (b.agents.length ? countPendingCells(db, tenant, b.id) : Promise.resolve(0))),
  );
  const canEdit = tenant.role !== "member";

  return (
    <>
      <PageHeader
        icon={<Sheet />}
        title="Tablas"
        tip="Las tablas de todos tus proyectos: empresas o personas con las columnas que tú decides, que rellenan los agentes de prospección y revisa tu equipo."
        actions={
          canEdit && projects.length ? (
            <NewTableButton projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
          ) : null
        }
      />
      {bases.length === 0 ? (
        <EmptyState
          icon={<Sheet />}
          title="Todavía no hay tablas"
          description="Créalas con «Nueva tabla» o al añadir un agente que trabaje en una. Aquí verás las de todos tus proyectos."
          action={
            canEdit ? (
              projects.length ? (
                <NewTableButton projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
              ) : (
                <NewProjectButton />
              )
            ) : null
          }
        />
      ) : (
        <Card>
          <Table head={["Tabla", "Proyecto", "Filas", "Por completar", "La rellena", "Última actividad"]}>
            {bases.map((b, i) => (
              <tr key={b.id} className="relative transition-colors hover:bg-ink-25">
                <Td>
                  <Link
                    href={`/app/projects/${b.projectId}/prospects/${b.id}`}
                    className="inline-flex items-center gap-2 font-medium after:absolute after:inset-0 hover:text-accent"
                  >
                    {b.rowKind === "person" ? (
                      <User className="size-4 text-muted" aria-hidden />
                    ) : (
                      <Building2 className="size-4 text-muted" aria-hidden />
                    )}
                    {b.name}
                  </Link>
                </Td>
                <Td className="text-muted">{b.projectName}</Td>
                <Td className="tabular-nums">{plural(b.rows, "fila", "filas")}</Td>
                <Td className="tabular-nums">
                  {pending[i] ? pending[i] : <span className="text-muted">—</span>}
                </Td>
                <Td className="text-muted">{b.agents.length ? b.agentNames.join(", ") : "A mano"}</Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(b.lastActivity)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
