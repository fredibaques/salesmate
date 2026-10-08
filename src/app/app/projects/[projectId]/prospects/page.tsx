import { Database } from "lucide-react";
import { EmptyState, LinkButton, Toolbar } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listAllBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { NewTableButton } from "../../../tables/new-table-button";
import { TablesList } from "../../../tables/tables-list";

export const metadata = { title: "Tablas" };

/** The project's tables, listed as in the «Tablas» section. */
export default async function ProjectTablesPage({
  params,
}: PageProps<"/app/projects/[projectId]/prospects">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const bases = await listAllBases(db, tenant, { projectId });
  // Cells left to fill, only where an agent fills the table.
  const pending = await Promise.all(
    bases.map((b) => (b.agents.length ? countPendingCells(db, tenant, b.id) : Promise.resolve(0))),
  );
  const canEdit = tenant.role !== "member";
  const newTable = (variant: "primary" | "secondary") =>
    canEdit ? <NewTableButton projectId={projectId} variant={variant} /> : null;

  if (bases.length === 0) {
    return (
      <EmptyState
        icon={<Database />}
        title="Todavía no hay tablas"
        description="Una tabla de empresas o personas con las columnas que tú decides. La rellenan los agentes del proyecto, tu equipo o el formulario de tu web."
        action={
          <>
            {newTable("primary")}
            {canEdit ? (
              <LinkButton href={`/app/projects/${projectId}/agents/new/outbound`}>
                Añadir el agente de prospección
              </LinkButton>
            ) : null}
          </>
        }
      />
    );
  }

  return (
    <>
      <Toolbar>{newTable("primary")}</Toolbar>
      <TablesList bases={bases} pending={pending} showProject={false} />
    </>
  );
}
