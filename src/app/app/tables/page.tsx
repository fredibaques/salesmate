import { Sheet } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { listVisibleProjects, projectAccess, requireTenant } from "@/server/auth/session";
import { canSeeBase } from "@/server/services/access";
import { getDb } from "@/server/db/client";
import { listAllBases } from "@/server/prospects/bases";
import { countPendingCells } from "@/server/prospects/complete";
import { NewTableButton } from "./new-table-button";
import { TablesList } from "./tables-list";

export const metadata = { title: "Tablas" };

/**
 * Every table of the organization, with a project or on their own: what the
 * agents, the team and the web forms fill.
 */
export default async function TablesPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [all, projects, visible] = await Promise.all([
    listAllBases(db, tenant),
    listVisibleProjects(),
    projectAccess(),
  ]);
  const bases = all.filter((b) => canSeeBase(visible, b));
  const pending = await Promise.all(
    bases.map((b) => (b.agents.length ? countPendingCells(db, tenant, b.id) : Promise.resolve(0))),
  );
  const canEdit = tenant.role !== "member";
  const newTable = canEdit ? (
    <NewTableButton projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
  ) : null;

  return (
    <>
      <PageHeader
        icon={<Sheet />}
        title="Tablas"
        tip="Empresas o personas con las columnas que tú decides. Las rellenan los agentes, tu equipo o el formulario de tu web; pueden ser de un proyecto, compartirse entre varios o usarse en todos."
        actions={bases.length ? newTable : null}
      />
      {bases.length === 0 ? (
        <EmptyState
          icon={<Sheet />}
          title="Todavía no hay tablas"
          description="Crea una para tus prospectos, los contactos que llegan por tu web o lo que quieras seguir. Aquí verás todas, de todos tus proyectos y las compartidas."
          action={newTable}
        />
      ) : (
        <TablesList bases={bases} pending={pending} />
      )}
    </>
  );
}
