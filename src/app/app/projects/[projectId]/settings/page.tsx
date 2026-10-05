import { ActionForm } from "@/components/action-form";
import { Card, Chip, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/services/projects";
import { saveProject } from "../actions";
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
  const project = (await getProject(getDb(), tenant, projectId))!;
  const s = project.settings;
  const sendDays = s.sendDays ?? [1, 2, 3, 4, 5];

  return (
    <>
      <SettingsNav projectId={projectId} />
      <PageHeader level="section" title="Datos del proyecto" />
      <div className="max-w-3xl">
        <Card>
          <ActionForm action={saveProject.bind(null, project.id)} submitLabel="Guardar" className="space-y-4">
            <Field label="Nombre">
              <Input name="name" defaultValue={project.name} required />
            </Field>
            <Field label="Descripción">
              <Textarea name="description" defaultValue={project.description ?? ""} />
            </Field>
            <Field label="Web">
              <Input name="website" type="url" defaultValue={project.website ?? ""} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Zona horaria">
                <Input name="timezone" defaultValue={project.timezone} />
              </Field>
              <Field label="Idiomas">
                <Input name="languages" defaultValue={project.languages.join(", ")} />
              </Field>
            </div>

            <h3 className="pt-2 text-sm font-semibold">Contacto con terceros</h3>
            <p className="text-xs text-muted">
              Las acciones que llegan a personas de fuera (emails, invitaciones) solo se ejecutan en esta
              franja; fuera de ella quedan programadas.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
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
            </div>
            <Field
              label="Enfriamiento entre proyectos (días)"
              tip="Si otro de tus proyectos contactó con la misma persona en este plazo, la acción pedirá tu aprobación."
            >
              <Input
                name="cooldown"
                type="number"
                min={0}
                max={365}
                defaultValue={s.crossProjectCooldownDays ?? 30}
              />
            </Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
