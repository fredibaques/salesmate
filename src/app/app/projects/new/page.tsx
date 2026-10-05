import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { createProjectAction } from "../actions";
import { NewProjectFields, PROJECT_HELP } from "../new-project";

export const metadata = { title: "Nuevo proyecto" };

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title="Nuevo proyecto" description={PROJECT_HELP} />
      <Card className="max-w-2xl">
        <ActionForm action={createProjectAction} submitLabel="Crear proyecto" className="space-y-4">
          <NewProjectFields />
        </ActionForm>
      </Card>
    </>
  );
}
