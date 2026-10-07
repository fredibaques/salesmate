import { Database } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireRole } from "@/server/auth/session";
import { NewBaseWizard } from "./new-base-wizard";

export const metadata = { title: "Nueva base de prospectos" };

/** Creating a base of the project, step by step. */
export default async function NewBasePage({ params }: PageProps<"/app/projects/[projectId]/prospects/new">) {
  const { projectId } = await params;
  await requireRole(["owner", "admin"]);
  return (
    <>
      <PageHeader
        icon={<Database />}
        title="Nueva base de prospectos"
        tip="Una tabla de empresas o personas con las columnas que tú decides. Los agentes del proyecto la rellenan y tu equipo la revisa, la completa y la exporta."
      />
      <NewBaseWizard projectId={projectId} />
    </>
  );
}
