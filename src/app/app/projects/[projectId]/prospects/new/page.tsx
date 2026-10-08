import { Database } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listProjects } from "@/server/services/projects";
import { NewTableForm } from "../../../../tables/new-table-form";

export const metadata = { title: "Nueva tabla" };

/** A new table of the project (the agents' instructions link here). */
export default async function NewTablePage({ params }: PageProps<"/app/projects/[projectId]/prospects/new">) {
  const { projectId } = await params;
  const tenant = await requireRole(["owner", "admin"]);
  const projects = await listProjects(getDb(), tenant);
  return (
    <>
      <PageHeader icon={<Database />} title="Nueva tabla" />
      <Card className="max-w-2xl">
        <NewTableForm projectId={projectId} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      </Card>
    </>
  );
}
