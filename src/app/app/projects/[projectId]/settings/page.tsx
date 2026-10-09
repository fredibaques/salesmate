import { Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Card, Chip, Field, FormSection, Input, Notice } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/services/projects";
import { ProjectBasicsFields } from "../../profile-fields";
import { deleteProjectAction, saveProject } from "../actions";
import { SettingsNav } from "../section-navs";

export const metadata = { title: "Ajustes del proyecto" };

const DAYS = [
  [1, "L"],
  [2, "M"],
  [3, "X"],
  [4, "J"],
  [5, "V"],
  [6, "S"],
  [7, "D"],
] as const;

export default async function ProjectSettingsPage({
  params,
}: PageProps<"/app/projects/[projectId]/settings">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const project = await getProject(db, tenant, projectId);
  const s = project!.settings;
  const sendDays = s.sendDays ?? [1, 2, 3, 4, 5];

  return (
    <>
      <SettingsNav projectId={projectId} />
      <div className="max-w-3xl space-y-6">
        <Card title="Proyecto">
          <ActionForm action={saveProject.bind(null, projectId)} submitLabel="Guardar" className="space-y-5">
            <ProjectBasicsFields project={project!} />
            <FormSection
              title="Contacto con terceros"
              tip="Las acciones que llegan a personas de fuera (emails, invitaciones) solo se ejecutan en esta franja; fuera de ella quedan programadas."
            >
              <Field label="Desde">
                <Input name="sendFrom" type="time" defaultValue={s.sendWindow?.[0] ?? "08:00"} />
              </Field>
              <Field label="Hasta">
                <Input name="sendTo" type="time" defaultValue={s.sendWindow?.[1] ?? "20:00"} />
              </Field>
              <Field label="Días" group>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS.map(([n, label]) => (
                    <Chip key={n} name="sendDays" value={n} defaultChecked={sendDays.includes(n)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </Field>
              <Field
                label="Enfriamiento entre proyectos"
                tip="Si otro de tus proyectos contactó con la misma persona en este plazo, la acción pedirá tu aprobación."
              >
                <Input
                  name="cooldown"
                  type="number"
                  min={0}
                  max={365}
                  suffix="días"
                  defaultValue={s.crossProjectCooldownDays ?? 30}
                />
              </Field>
            </FormSection>
          </ActionForm>
        </Card>

        {tenant.role !== "member" ? (
          <Card title="Eliminar el proyecto">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-sm text-muted">
                Se borran sus agentes, conocimiento, conversaciones y reglas. Sus tablas se quedan, sin
                proyecto; las conexiones de tu organización y el registro de auditoría también. No se puede
                deshacer.
              </p>
              <ModalButton
                label="Eliminar proyecto"
                icon={<Trash2 />}
                title={`Eliminar «${project!.name}»`}
                variant="dangerGhost"
              >
                <ActionForm
                  action={deleteProjectAction.bind(null, projectId)}
                  submitLabel="Eliminar para siempre"
                  submitVariant="danger"
                  className="space-y-4"
                >
                  <Notice tone="danger">
                    Se borrará todo lo que hay dentro del proyecto y los agentes dejarán de trabajar en él. No
                    se puede deshacer.
                  </Notice>
                  <Field label={`Escribe «${project!.name}» para confirmar`}>
                    <Input name="confirmName" required autoComplete="off" />
                  </Field>
                </ActionForm>
              </ModalButton>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
