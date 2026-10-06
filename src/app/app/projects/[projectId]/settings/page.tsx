import { Sparkles, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Card, Chip, Field, FormSection, Input, Notice, Textarea } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { isLlmConfigured } from "@/server/llm/client";
import { getSalesProfile } from "@/server/services/agents";
import { getProject } from "@/server/services/projects";
import { CustomerFields, OfferFields, ProjectBasicsFields, VoiceFields } from "../../profile-fields";
import { deleteProjectAction, saveProject } from "../actions";
import { draftOffer, saveOffer } from "../offer/actions";
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
  const [project, profile] = await Promise.all([
    getProject(db, tenant, projectId),
    getSalesProfile(db, tenant, projectId),
  ]);
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

        <section id="oferta" className="scroll-mt-6">
          <Card
            title="Oferta y cliente"
            tip="Lo que todos los agentes de este proyecto necesitan saber de tu venta: qué ofreces, a quién y cómo hablarle. Lo propio de cada agente se configura en su ficha."
            actions={
              isLlmConfigured() ? (
                <ModalButton
                  label="Proponer con IA"
                  icon={<Sparkles />}
                  title="Proponer oferta y cliente con IA"
                  variant="secondary"
                  size="sm"
                >
                  <ActionForm
                    action={draftOffer.bind(null, projectId)}
                    submitLabel="Generar"
                    className="space-y-4"
                  >
                    <Notice tone="warning">
                      Lee la descripción y el conocimiento del proyecto y sustituye cliente ideal, problemas,
                      objeciones y tono. La oferta y la firma no se tocan.
                    </Notice>
                    <Field label="Indicaciones" optional>
                      <Textarea
                        name="instructions"
                        placeholder="p. ej. Vendemos sobre todo a concesionarios multimarca"
                      />
                    </Field>
                  </ActionForm>
                </ModalButton>
              ) : null
            }
          >
            {/* Remount when the stored profile changes (e.g. after the AI proposal) so fields show it. */}
            <ActionForm
              key={JSON.stringify(profile)}
              action={saveOffer.bind(null, projectId)}
              submitLabel="Guardar"
              className="space-y-5"
            >
              <FormSection title="Oferta">
                <OfferFields profile={profile} />
              </FormSection>
              <FormSection title="Tu cliente">
                <CustomerFields profile={profile} />
              </FormSection>
              <FormSection title="Cómo hablar">
                <VoiceFields profile={profile} />
              </FormSection>
            </ActionForm>
          </Card>
        </section>

        {tenant.role !== "member" ? (
          <Card title="Eliminar el proyecto">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-sm text-muted">
                Se borran sus agentes, conocimiento, conversaciones, prospectos y reglas. Las conexiones de tu
                organización y el registro de auditoría se conservan. No se puede deshacer.
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
