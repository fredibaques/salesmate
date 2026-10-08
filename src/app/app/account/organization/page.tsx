import { Building2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input, LinkButton } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { renameOrganization } from "../actions";

export const metadata = { title: "Organización" };

export default async function OrganizationPage() {
  const tenant = await requireTenant();
  const canEdit = tenant.role === "owner" || tenant.role === "admin";

  return (
    <>
      <Card
        title="Organización"
        tip="La organización agrupa tus proyectos, las herramientas conectadas y las personas que trabajan en ellos."
        actions={
          <LinkButton href="/app/users" variant="ghost" size="sm">
            Gestionar usuarios
          </LinkButton>
        }
      >
        {canEdit ? (
          <ActionForm
            key={tenant.organization.name}
            action={renameOrganization}
            submitLabel="Guardar"
            className="space-y-4"
          >
            <Field label="Nombre">
              <Input
                name="name"
                defaultValue={tenant.organization.name}
                required
                minLength={2}
                icon={<Building2 />}
              />
            </Field>
          </ActionForm>
        ) : (
          <Field label="Nombre" hint="Solo quien administra la organización puede cambiarlo.">
            <Input value={tenant.organization.name} disabled icon={<Building2 />} />
          </Field>
        )}
      </Card>
    </>
  );
}
