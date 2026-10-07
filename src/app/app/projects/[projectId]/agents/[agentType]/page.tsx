import { Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Card, Choice, Field, FormSection, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { SALES_MOTIONS } from "@/server/db/schema";
import { AI_CONNECT_HREF, currentAi } from "../../../../ai-notice";
import {
  CALENDAR_STEPS,
  NEXT_STEP_DESCRIPTIONS,
  NEXT_STEP_LABELS,
  NEXT_STEPS,
  SALES_MOTION_LABELS,
} from "@/server/playbooks/spec";
import { getAgent, isProjectAgentType, listChannelOptions } from "@/server/services/agents";
import { getProject, listMeetingTypes } from "@/server/services/projects";
import { MeetingTypesCard } from "../../meeting-types";
import { draftProcess, saveProcess } from "../actions";
import { OutboundHome } from "./outbound-home";

const join = (items: string[]) => items.join("\n");

export default async function AgentHomePage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentType]">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType)) notFound();
  // Agents without a conversation process start on their instructions.
  if (agentType === "outbound") return <OutboundHome projectId={projectId} />;
  const tenant = await requireTenant();
  const db = getDb();
  const [agent, meetingTypes, options, project, ai] = await Promise.all([
    getAgent(db, tenant, projectId, agentType),
    listMeetingTypes(db, tenant, projectId),
    listChannelOptions(db, tenant),
    getProject(db, tenant, projectId),
    currentAi(),
  ]);
  if (!agent?.process) notFound();
  const { process } = agent;
  const s = process.spec;
  const [primary, ...alternatives] = s.nextSteps;
  const usesCalendar = s.nextSteps.some((step) => CALENDAR_STEPS.includes(step));

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
      <div className="space-y-6">
        <Card
          title="Proceso de venta"
          tip="Cómo trabaja este agente con cada contacto. Lo común a todos los agentes (qué vendes, a quién, objeciones, tono y firma) está en Ajustes → Oferta y cliente."
        >
          <ActionForm
            key={process.currentVersion}
            action={saveProcess.bind(null, projectId, agentType)}
            submitLabel="Guardar proceso"
            className="space-y-5"
          >
            <FormSection title="Tipo de venta">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Modelo de venta">
                  <Select name="salesMotion" defaultValue={process.salesMotion}>
                    {SALES_MOTIONS.map((m) => (
                      <option key={m} value={m}>
                        {SALES_MOTION_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Atiende a">
                  <Select name="customerType" defaultValue={s.customerType}>
                    <option value="b2b">Empresas (B2B)</option>
                    <option value="b2c">Particulares (B2C)</option>
                  </Select>
                </Field>
              </div>
              <Field label="Objetivo" hint="En una frase, qué consigue una conversación que va bien.">
                <Input
                  name="objective"
                  defaultValue={s.objective}
                  placeholder="p. ej. Conseguir una demo con quien decide en el concesionario"
                />
              </Field>
            </FormSection>

            <FormSection
              title="¿Cómo debe terminar una buena conversación?"
              tip="Es lo que el agente intenta conseguir con cada contacto. Elige el resultado principal; si con un contacto no es posible, probará con las alternativas que marques."
            >
              <div className="grid gap-2 sm:grid-cols-2">
                {NEXT_STEPS.map((step) => (
                  <Choice
                    key={step}
                    card
                    type="radio"
                    name="primaryStep"
                    value={step}
                    defaultChecked={step === primary}
                    label={NEXT_STEP_LABELS[step]}
                    description={NEXT_STEP_DESCRIPTIONS[step]}
                  />
                ))}
              </div>
              <Field label="Si no es posible, alternativas" hint="Se prueban en este orden." group>
                <div className="grid gap-2 sm:grid-cols-2">
                  {NEXT_STEPS.map((step) => (
                    <Choice
                      key={step}
                      name="alternativeSteps"
                      value={step}
                      defaultChecked={alternatives.includes(step)}
                      label={NEXT_STEP_LABELS[step]}
                    />
                  ))}
                </div>
              </Field>
              {usesCalendar ? (
                <Field
                  label="Reunión que ofrece"
                  tip="Duración y horario salen del tipo de reunión. Los gestionas en «Reuniones que puede agendar»."
                >
                  <Select name="meetingTypeId" defaultValue={s.meetingTypeId ?? ""}>
                    <option value="">— Elige un tipo de reunión —</option>
                    {meetingTypes.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <input type="hidden" name="meetingTypeId" value={s.meetingTypeId ?? ""} />
              )}
            </FormSection>

            <FormSection
              title="Cualificación"
              tip="Cómo decide el agente si un contacto encaja y qué necesita saber antes de seguir."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Criterios" hint="Uno por línea. Empieza con * los imprescindibles.">
                  <Textarea
                    name="qualification"
                    defaultValue={join(s.qualification.map((q) => `${q.required ? "* " : ""}${q.criterion}`))}
                  />
                </Field>
                <Field label="Descartar si" hint="Uno por línea.">
                  <Textarea name="disqualifiers" defaultValue={join(s.disqualifiers)} />
                </Field>
              </div>
              <Field
                label="Datos que tiene que reunir"
                hint="Uno por línea, p. ej. para preparar un presupuesto."
              >
                <Textarea name="requiredData" defaultValue={join(s.requiredData)} />
              </Field>
            </FormSection>

            <FormSection
              title="Límites"
              tip="Lo que este agente no debe hacer nunca y cuándo debe pasar a una persona."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Reglas" hint="Una por línea.">
                  <Textarea name="rules" defaultValue={join(s.rules)} />
                </Field>
                <Field label="Pasar a una persona cuando" hint="Una por línea.">
                  <Textarea name="handoff" defaultValue={join(s.handoff)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tiempo objetivo de respuesta (min)">
                  <Input
                    name="responseTimeMinutes"
                    type="number"
                    min={1}
                    defaultValue={s.responseTimeMinutes}
                  />
                </Field>
                <Field label="Nota de este cambio" optional>
                  <Input name="notes" placeholder="Qué has cambiado" />
                </Field>
              </div>
            </FormSection>
          </ActionForm>
        </Card>

        {usesCalendar ? (
          <MeetingTypesCard
            projectId={projectId}
            timezone={project?.timezone ?? "Europe/Madrid"}
            types={meetingTypes}
            calendars={options.calendars}
          />
        ) : null}
      </div>

      <div className="space-y-6">
        <Card
          title="Proponer con IA"
          tip="Lee la oferta y el conocimiento del proyecto y propone el proceso. Se guarda como una versión nueva para que la revises."
        >
          {ai ? (
            <ModalButton
              label="Generar propuesta"
              icon={<Sparkles className="size-4" />}
              title="Proponer el proceso con IA"
              variant="secondary"
            >
              <ActionForm
                action={draftProcess.bind(null, projectId, agentType)}
                submitLabel="Generar"
                className="space-y-4"
              >
                <Field label="Indicaciones" optional>
                  <Textarea
                    name="instructions"
                    placeholder="p. ej. Nos interesan concesionarios con más de 20 operaciones al mes"
                  />
                </Field>
              </ActionForm>
            </ModalButton>
          ) : (
            <LinkButton href={AI_CONNECT_HREF} size="sm">
              Conectar IA
            </LinkButton>
          )}
        </Card>

        <Card title="Versiones">
          <ul className="divide-y divide-border text-sm">
            {process.history.map((v) => (
              <li key={v.id} className="py-2 first:pt-0">
                <span className="font-medium">v{v.version}</span>{" "}
                <span className="text-xs text-muted">{formatDateTime(v.createdAt)}</span>
                {v.notes ? <p className="text-xs text-muted">{v.notes}</p> : null}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
