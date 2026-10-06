import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { PROJECT_HELP } from "../new-project";
import { ProjectWizard } from "./project-wizard";

export const metadata = { title: "Nuevo proyecto" };

export default async function NewProjectPage() {
  await requireTenant();
  return (
    <>
      <PageHeader title="Nuevo proyecto" tip={PROJECT_HELP} back={{ href: "/app", label: "Panel" }} />
      <ProjectWizard />
    </>
  );
}
