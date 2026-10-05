import { eq } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Input, Table, Td } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { member, user } from "@/server/db/schema";
import { renameOrganization } from "../actions";

export const metadata = { title: "Organización" };

const ROLE_LABELS: Record<string, { label: string; tone: "accent" | "neutral" }> = {
  owner: { label: "Propietario", tone: "accent" },
  admin: { label: "Administrador", tone: "accent" },
  member: { label: "Miembro", tone: "neutral" },
};

export default async function OrganizationPage() {
  const tenant = await requireTenant();
  const canEdit = tenant.role === "owner" || tenant.role === "admin";
  const members = await getDb()
    .select({ id: member.id, role: member.role, since: member.createdAt, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, tenant.orgId));

  return (
    <>
      <Card
        title="Organización"
        tip="La organización agrupa tus proyectos, las herramientas conectadas y las personas que trabajan en ellos."
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

      <Card
        title="Personas"
        tip="Quién puede entrar en esta organización y con qué permisos. Quien administra puede configurar agentes, conexiones y reglas; los miembros, consultar y aprobar."
      >
        <Table head={["Nombre", "Email", "Rol", "Desde"]}>
          {members.map((m) => {
            const role = ROLE_LABELS[m.role] ?? { label: m.role, tone: "neutral" as const };
            return (
              <tr key={m.id}>
                <Td className="font-medium">
                  {m.name}
                  {m.email === tenant.user.email ? <span className="ml-1 text-muted">(tú)</span> : null}
                </Td>
                <Td className="text-muted">{m.email}</Td>
                <Td>
                  <Badge tone={role.tone}>{role.label}</Badge>
                </Td>
                <Td className="text-muted">{formatDate(m.since)}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
