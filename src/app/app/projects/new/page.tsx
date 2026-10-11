import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { currentBusiness } from "../new-project";
import { ProjectWizard } from "./project-wizard";

export const metadata = { title: "Nuevo proyecto" };

const PROJECT_HELP =
  "Un proyecto es un objetivo comercial: a quién te diriges y qué quieres conseguir. Lo que vendes y cómo hablas es de tu negocio y lo comparten todos.";

export default async function NewProjectPage() {
  await requireTenant();
  return (
    <>
      <PageHeader title="Nuevo proyecto" tip={PROJECT_HELP} />
      <ProjectWizard business={await currentBusiness()} />
    </>
  );
}
