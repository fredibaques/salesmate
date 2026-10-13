import { Pencil, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { ModalButton } from "@/components/modal";
import { Badge, Card, Chip, Choice, Field, Input, Notice, Table, Td } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { mailConfigured } from "@/server/mail";
import { sharedProjectsByUser } from "@/server/services/access";
import { listProjects } from "@/server/services/projects";
import { listTeam } from "@/server/services/team";
import {
  cancelInvitationAction,
  changeMemberRoleAction,
  resendInvitationAction,
  inviteMemberAction,
  removeMemberAction,
  setMemberProjectsAction,
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
    description:
      "Trabaja en los proyectos que le compartas: sus tablas y conversaciones, y aprueba lo que proponen sus agentes.",
  },
  {
    value: "admin",
    label: "Administrador",
    description: "Ve todos los proyectos, configura agentes, conexiones y reglas, e invita a otras personas.",
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

/** The projects shared with a member (chips). */
function ProjectChips({
  projects,
  selected = [],
  tip,
}: {
  projects: { id: string; name: string }[];
  selected?: string[];
  tip: string;
}) {
  return (
    <Field label="Proyectos" tip={tip} optional group>
      <div className="flex flex-wrap gap-1.5">
        {projects.map((p) => (
          <Chip key={p.id} name="projects" value={p.id} defaultChecked={selected.includes(p.id)}>
            {p.name}
          </Chip>
        ))}
      </div>
    </Field>
  );
}

/** Who can use the organization: invite people, change their role, remove them. */
export default async function UsersPage() {
  const tenant = await requireTenant();
  const canEdit = tenant.role === "owner" || tenant.role === "admin";
  const db = getDb();
  const [{ members, invitations }, projects, shared] = await Promise.all([
    listTeam(db, tenant.orgId),
    canEdit ? listProjects(db, tenant) : Promise.resolve([]),
    sharedProjectsByUser(db, tenant.orgId),
  ]);
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const isOwner = tenant.role === "owner";
  const appUrl = env().APP_URL;
  const mail = mailConfigured();

  return (
    <div className="max-w-4xl space-y-6">
      {canEdit && !mail ? (
        <Notice tone="warning">
          Las invitaciones aún no salen por email: copia el enlace de cada una y envíaselo a la persona.
        </Notice>
      ) : null}
      <Card
        title="Personas"
        tip="Quién puede entrar en esta organización y con qué permisos. Cada invitación es un enlace: le llega por email (si el envío está configurado) y también puedes copiarlo. Quien lo abra entra con la cuenta de ese email (o la crea)."
        actions={
          canEdit ? (
            <ModalButton label="Invitar" icon={<UserPlus className="size-4" />} title="Invitar a una persona">
              <ActionForm
                action={inviteMemberAction}
                submitLabel={mail ? "Enviar invitación" : "Crear invitación"}
                className="space-y-4"
              >
                <Field label="Email" hint="Tendrá que entrar o registrarse con este email.">
                  <Input name="email" type="email" required placeholder="nombre@empresa.com" />
                </Field>
                <Field label="Rol" group>
                  <RoleChoices current="member" canOwn={isOwner} />
                </Field>
                {projects.length ? (
                  <ProjectChips
                    projects={projects}
                    tip="Si entra como miembro, solo verá estos. Quien administra ve todos."
                  />
                ) : null}
              </ActionForm>
            </ModalButton>
          ) : null
        }
      >
        <Table
          head={
            canEdit
              ? ["Nombre", "Email", "Rol", "Proyectos", "Desde", ""]
              : ["Nombre", "Email", "Rol", "Proyectos", "Desde"]
          }
        >
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
                <Td className="text-muted">
                  {m.role === "member"
                    ? (shared.get(m.userId) ?? [])
                        .map((id) => projectNames.get(id))
                        .filter(Boolean)
                        .join(", ") || "Ninguno"
                    : "Todos"}
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
                        {m.role === "member" && projects.length ? (
                          <ActionForm
                            action={setMemberProjectsAction.bind(null, m.userId)}
                            submitLabel="Guardar proyectos"
                            cancel={false}
                            className="mt-6 space-y-4 border-t border-border pt-5"
                          >
                            <ProjectChips
                              projects={projects}
                              selected={shared.get(m.userId) ?? []}
                              tip="Los que puede ver y en los que puede trabajar."
                            />
                          </ActionForm>
                        ) : null}
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
                          {mail ? (
                            <ActionForm
                              action={resendInvitationAction.bind(null, i.id)}
                              submitLabel="Reenviar"
                              submitVariant="secondary"
                              cancel={false}
                              className="flex items-center gap-2"
                            />
                          ) : null}
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
