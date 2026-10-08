import { Pencil, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { ModalButton } from "@/components/modal";
import { Badge, Card, Choice, Field, Input, Table, Td } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { listTeam } from "@/server/services/team";
import {
  cancelInvitationAction,
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
} from "./actions";

export const metadata = { title: "Usuarios" };

const ROLE_LABELS: Record<string, { label: string; tone: "accent" | "neutral" }> = {
  owner: { label: "Propietario", tone: "accent" },
  admin: { label: "Administrador", tone: "accent" },
  member: { label: "Miembro", tone: "neutral" },
};

const ROLES = [
  {
    value: "member",
    label: "Miembro",
    description: "Consulta proyectos, tablas y conversaciones, y aprueba lo que proponen los agentes.",
  },
  {
    value: "admin",
    label: "Administrador",
    description: "Además, configura agentes, conexiones, reglas e invita a otras personas.",
  },
  {
    value: "owner",
    label: "Propietario",
    description: "Todo lo anterior y gestionar a otros propietarios.",
  },
];

/** The roles someone can hand out: only owners make owners. */
function RoleChoices({ current, canOwn }: { current: string; canOwn: boolean }) {
  return (
    <div className="space-y-2">
      {ROLES.filter((r) => canOwn || r.value !== "owner").map((r) => (
        <Choice
          key={r.value}
          card
          type="radio"
          name="role"
          value={r.value}
          defaultChecked={r.value === current}
          label={r.label}
          description={r.description}
        />
      ))}
    </div>
  );
}

/** Who can use the organization: invite people, change their role, remove them. */
export default async function UsersPage() {
  const tenant = await requireTenant();
  const canEdit = tenant.role === "owner" || tenant.role === "admin";
  const { members, invitations } = await listTeam(getDb(), tenant.orgId);
  const isOwner = tenant.role === "owner";
  const appUrl = env().APP_URL;

  return (
    <div className="max-w-4xl">
      <Card
        title="Personas"
        tip="Quién puede entrar en esta organización y con qué permisos. Invita con un enlace: quien lo abra entra con la cuenta de ese email (o la crea)."
        actions={
          canEdit ? (
            <ModalButton label="Invitar" icon={<UserPlus className="size-4" />} title="Invitar a una persona">
              <ActionForm action={inviteMemberAction} submitLabel="Crear invitación" className="space-y-4">
                <Field label="Email" hint="Tendrá que entrar o registrarse con este email.">
                  <Input name="email" type="email" required placeholder="nombre@empresa.com" />
                </Field>
                <Field label="Rol" group>
                  <RoleChoices current="member" canOwn={isOwner} />
                </Field>
              </ActionForm>
            </ModalButton>
          ) : null
        }
      >
        <Table head={canEdit ? ["Nombre", "Email", "Rol", "Desde", ""] : ["Nombre", "Email", "Rol", "Desde"]}>
          {members.map((m) => {
            const role = ROLE_LABELS[m.role] ?? { label: m.role, tone: "neutral" as const };
            const me = m.userId === tenant.userId;
            // Admins don't manage owners; nobody edits themselves here.
            const editable = canEdit && !me && (isOwner || m.role !== "owner");
            return (
              <tr key={m.id}>
                <Td className="font-medium">
                  {m.name}
                  {me ? <span className="ml-1 text-muted">(tú)</span> : null}
                </Td>
                <Td className="text-muted">{m.email}</Td>
                <Td>
                  <Badge tone={role.tone}>{role.label}</Badge>
                </Td>
                <Td className="text-muted">{formatDate(m.since)}</Td>
                {canEdit ? (
                  <Td className="text-right">
                    {editable ? (
                      <ModalButton
                        label={`Editar a ${m.name}`}
                        icon={<Pencil className="size-4" />}
                        title={m.name}
                        variant="ghost"
                        size="sm"
                        iconOnly
                      >
                        <ActionForm
                          action={changeMemberRoleAction.bind(null, m.id)}
                          submitLabel="Guardar rol"
                          className="space-y-4"
                        >
                          <Field label="Rol" group>
                            <RoleChoices current={m.role} canOwn={isOwner} />
                          </Field>
                        </ActionForm>
                        <div className="mt-6 space-y-3 border-t border-border pt-5">
                          <h3 className="text-sm font-medium">Quitar de la organización</h3>
                          <ActionForm
                            action={removeMemberAction.bind(null, m.id)}
                            submitLabel={`Quitar a ${m.name}`}
                            submitVariant="danger"
                            confirm={`¿Quitar a ${m.name} (${m.email})? Dejará de poder entrar en esta organización. Lo que haya hecho se conserva.`}
                            cancel={false}
                          />
                        </div>
                      </ModalButton>
                    ) : null}
                  </Td>
                ) : null}
              </tr>
            );
          })}
        </Table>
        {invitations.length ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium">Invitaciones pendientes</h3>
            <Table head={canEdit ? ["Email", "Rol", "Caduca", ""] : ["Email", "Rol", "Caduca"]}>
              {invitations.map((i) => {
                const role = ROLE_LABELS[i.role ?? "member"] ?? ROLE_LABELS.member;
                return (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.email}</Td>
                    <Td>
                      <Badge tone={role.tone}>{role.label}</Badge>
                    </Td>
                    <Td className="text-muted">{formatDate(i.expiresAt)}</Td>
                    {canEdit ? (
                      <Td>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <CopyButton text={`${appUrl}/invite/${i.id}`} label="Copiar enlace" />
                          <ActionForm
                            action={cancelInvitationAction.bind(null, i.id)}
                            submitLabel="Cancelar"
                            submitVariant="ghost"
                            cancel={false}
                            className="flex items-center gap-2"
                          />
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </Table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
