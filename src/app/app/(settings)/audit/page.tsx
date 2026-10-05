import { ScrollText } from "lucide-react";
import { Card, EmptyState, PageHeader, Table, Td } from "@/components/ui";
import { describeEvent, formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listAudit, listProjects } from "@/server/services/projects";

export const metadata = { title: "Auditoría" };

export default async function AuditPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [events, projects] = await Promise.all([
    listAudit(db, tenant, { limit: 300 }),
    listProjects(db, tenant),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader
        level="section"
        title="Auditoría"
        description="Registro inmutable de todo lo que hacen las personas y los agentes."
      />
      <Card>
        {events.length === 0 ? (
          <EmptyState
            icon={<ScrollText />}
            title="Sin eventos todavía"
            description="Cada cambio que hagan las personas y cada acción de los agentes quedará registrada aquí, sin posibilidad de borrarse."
          />
        ) : (
          <Table head={["Fecha", "Evento", "Proyecto", "Quién", "Detalle"]}>
            {events.map((e) => (
              <tr key={e.id} className="transition-colors hover:bg-background">
                <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(e.createdAt)}</Td>
                <Td>
                  {describeEvent(e.event)}
                  <code className="block text-xs text-muted">{e.event}</code>
                </Td>
                <Td>{e.projectId ? (projectName.get(e.projectId) ?? "—") : "—"}</Td>
                <Td className="text-xs">
                  {e.actorType}
                  {e.actorId === tenant.userId ? " (tú)" : ""}
                </Td>
                <Td>
                  <code className="block max-w-xl truncate text-xs text-muted">{JSON.stringify(e.data)}</code>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
