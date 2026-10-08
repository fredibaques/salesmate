import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { ProjectWizard } from "./project-wizard";

export const metadata = { title: "Nuevo proyecto" };

const PROJECT_HELP =
  "Un proyecto es una empresa, una marca o tu actividad como autónomo. Cada uno tiene su oferta, sus herramientas, su conocimiento y sus reglas, aislados del resto.";

export default async function NewProjectPage() {
  await requireTenant();
  return (
    <>
      <PageHeader title="Nuevo proyecto" tip={PROJECT_HELP} />
      <ProjectWizard />
    </>
  );
}
