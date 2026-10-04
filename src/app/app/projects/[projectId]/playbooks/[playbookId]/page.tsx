import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { AGENT_LABELS, formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { isLlmConfigured } from "@/server/llm/client";
import { getPlaybook } from "@/server/playbooks/service";
import { NEXT_STEP_LABELS, NEXT_STEPS, SALES_MOTION_LABELS } from "@/server/playbooks/spec";
import { listMeetingTypes } from "@/server/services/projects";
import { aiDraft, changeStatus, saveVersion } from "../actions";

const join = (items: string[]) => items.join("\n");

export default async function PlaybookPage({
  params,
}: PageProps<"/app/projects/[projectId]/playbooks/[playbookId]">) {
  const { projectId, playbookId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [playbook, meetingTypes] = await Promise.all([
    getPlaybook(db, tenant, playbookId),
    listMeetingTypes(db, tenant, projectId),
  ]);
  if (!playbook) notFound();
  const s = playbook.spec;

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <Card
        title={playbook.name}
        description={
          <>
            {SALES_MOTION_LABELS[playbook.salesMotion]} · versión {playbook.currentVersion} ·{" "}
            <Link href={`/app/projects/${projectId}/playbooks`} className="text-accent">
              volver
            </Link>
          </>
        }
      >
        <ActionForm
          action={saveVersion.bind(null, projectId, playbookId)}
          submitLabel="Guardar nueva versión"
          className="space-y-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre">
              <Input name="name" defaultValue={playbook.name} />
            </Field>
            <Field label="Tipo de cliente">
              <Select name="customerType" defaultValue={s.customerType}>
                <option value="b2b">Empresas (B2B)</option>
                <option value="b2c">Particulares (B2C)</option>
              </Select>
            </Field>
          </div>
          <Field label="Agentes que lo usan">
            <div className="flex flex-wrap gap-3 text-sm">
              {(["inbound", "outbound", "account_manager"] as const).map((a) => (
                <label key={a} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="agentTypes"
                    value={a}
                    defaultChecked={playbook.agentTypes.includes(a)}
                  />{" "}
                  {AGENT_LABELS[a]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Objetivo">
            <Input
              name="objective"
              defaultValue={s.objective}
              placeholder="Qué consigue una conversación que va bien"
            />
          </Field>
          <Field label="Siguientes pasos permitidos" hint="Marca los que valen y ordénalos (1 = preferido).">
            <div className="grid gap-2 sm:grid-cols-2">
              {NEXT_STEPS.map((step) => {
                const idx = s.nextSteps.indexOf(step);
                return (
                  <label key={step} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`step:${step}`} defaultChecked={idx >= 0} />
                    <input
                      type="number"
                      name={`order:${step}`}
                      min={1}
                      max={9}
                      defaultValue={idx >= 0 ? idx + 1 : ""}
                      className="w-12 rounded border border-border bg-surface px-1 text-xs"
                    />
                    {NEXT_STEP_LABELS[step]}
                  </label>
                );
              })}
            </div>
          </Field>
          {s.nextSteps.some((x) => x === "meeting" || x === "callback") ? (
            <Field label="Tipo de reunión" hint="Se usa para ofrecer huecos reales.">
              <Select name="meetingTypeId" defaultValue={s.meetingTypeId ?? ""}>
                <option value="">— Ninguno —</option>
                {meetingTypes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="A quién nos dirigimos" hint="Uno por línea">
              <Textarea name="segmentInclude" defaultValue={join(s.segment.include)} />
            </Field>
            <Field label="A quién no" hint="Uno por línea">
              <Textarea name="segmentExclude" defaultValue={join(s.segment.exclude)} />
            </Field>
            <Field label="Zonas" hint="Una por línea">
              <Textarea name="geography" defaultValue={join(s.segment.geography)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quién decide" hint="Uno por línea">
              <Textarea name="decisionMakers" defaultValue={join(s.decisionMakers)} />
            </Field>
            <Field label="Problemas que resolvemos" hint="Uno por línea">
              <Textarea name="pains" defaultValue={join(s.pains)} />
            </Field>
          </div>
          <Field label="Propuesta de valor">
            <Textarea name="valueProposition" defaultValue={s.valueProposition} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cualificación" hint="Un criterio por línea; empieza con * los imprescindibles.">
              <Textarea
                name="qualification"
                defaultValue={join(s.qualification.map((q) => `${q.required ? "* " : ""}${q.criterion}`))}
              />
            </Field>
            <Field label="Descartar si" hint="Uno por línea">
              <Textarea name="disqualifiers" defaultValue={join(s.disqualifiers)} />
            </Field>
          </div>
          <Field label="Datos que hay que reunir" hint="Uno por línea (p. ej. para preparar un presupuesto).">
            <Textarea name="requiredData" defaultValue={join(s.requiredData)} />
          </Field>
          <Field label="Objeciones" hint="Una por línea con el formato: objeción => cómo responder">
            <Textarea
              name="objections"
              className="min-h-32"
              defaultValue={join(s.objections.map((o) => `${o.objection} => ${o.response}`))}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reglas" hint="Una por línea">
              <Textarea name="rules" defaultValue={join(s.rules)} />
            </Field>
            <Field label="Derivar a una persona cuando" hint="Una por línea">
              <Textarea name="handoff" defaultValue={join(s.handoff)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tono">
              <Textarea name="tone" defaultValue={s.tone} />
            </Field>
            <Field label="Firma de los emails">
              <Textarea name="signature" defaultValue={s.signature} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tiempo objetivo de respuesta (min)">
              <Input name="responseTimeMinutes" type="number" min={1} defaultValue={s.responseTimeMinutes} />
            </Field>
            <Field label="Nota de esta versión">
              <Input name="notes" placeholder="Qué has cambiado" />
            </Field>
          </div>
        </ActionForm>
      </Card>

      <div className="space-y-6">
        <Card title="Estado">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={playbook.status === "active" ? "success" : "neutral"}>
              {playbook.status === "active"
                ? "Activo"
                : playbook.status === "draft"
                  ? "Borrador"
                  : "Archivado"}
            </Badge>
            {playbook.status !== "active" ? (
              <form action={changeStatus.bind(null, projectId, playbookId, "active")}>
                <Button>Activar</Button>
              </form>
            ) : (
              <form action={changeStatus.bind(null, projectId, playbookId, "draft")}>
                <Button variant="secondary">Pasar a borrador</Button>
              </form>
            )}
            {playbook.status !== "archived" ? (
              <form action={changeStatus.bind(null, projectId, playbookId, "archived")}>
                <Button variant="ghost">Archivar</Button>
              </form>
            ) : null}
          </div>
        </Card>

        <Card
          title="Proponer con IA"
          description="Lee el conocimiento del proyecto y propone una versión mejorada. Se guarda como nueva versión para que la revises."
        >
          {isLlmConfigured() ? (
            <ActionForm
              action={aiDraft.bind(null, projectId, playbookId)}
              submitLabel="Generar borrador"
              className="space-y-3"
            >
              <Field label="Indicaciones (opcional)">
                <Textarea
                  name="instructions"
                  placeholder="p. ej. Nos dirigimos a empresas con más de 20 operaciones al mes"
                />
              </Field>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Configura ANTHROPIC_API_KEY para usar la IA.</p>
          )}
        </Card>

        <Card title="Versiones">
          <ul className="divide-y divide-border text-sm">
            {playbook.history.map((v) => (
              <li key={v.id} className="py-2">
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
