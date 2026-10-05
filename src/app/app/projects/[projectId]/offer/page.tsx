import { Sparkles } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Card, Field, Textarea, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { isLlmConfigured } from "@/server/llm/client";
import { getSalesProfile } from "@/server/services/agents";
import { draftOffer, saveOffer } from "./actions";
import { KnowledgeNav } from "../section-navs";

export const metadata = { title: "Oferta y cliente" };

const join = (items: string[]) => items.join("\n");

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint ? <p className="mt-0.5 text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

export default async function OfferPage({ params }: PageProps<"/app/projects/[projectId]/offer">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const p = await getSalesProfile(getDb(), tenant, projectId);

  return (
    <>
      <KnowledgeNav projectId={projectId} />
      <PageHeader
        level="section"
        title="Oferta y cliente"
        description="Lo que todos los agentes de este proyecto necesitan saber de tu venta: qué ofreces, a quién y cómo hablarle. Lo propio de cada agente (cómo termina la conversación, cualificación, límites) se configura en su ficha."
      />
      <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <Card>
          {/* Remount when the stored profile changes (e.g. after the AI proposal) so fields show it. */}
          <ActionForm
            key={JSON.stringify(p)}
            action={saveOffer.bind(null, projectId)}
            submitLabel="Guardar"
            className="space-y-5"
          >
            <Section title="Qué vendes">
              <Field label="Oferta" hint="Qué vendes y para qué sirve, en una o dos frases.">
                <Textarea name="offer" defaultValue={p.offer} />
              </Field>
              <Field label="Por qué te eligen" hint="Tu propuesta de valor frente a otras opciones.">
                <Textarea name="valueProposition" defaultValue={p.valueProposition} />
              </Field>
            </Section>

            <Section title="A quién" hint="Tu cliente ideal. Uno por línea.">
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Nos dirigimos a">
                  <Textarea name="segmentInclude" defaultValue={join(p.segment.include)} />
                </Field>
                <Field label="No nos dirigimos a">
                  <Textarea name="segmentExclude" defaultValue={join(p.segment.exclude)} />
                </Field>
                <Field label="Zonas">
                  <Textarea name="geography" defaultValue={join(p.segment.geography)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Quién decide la compra">
                  <Textarea name="decisionMakers" defaultValue={join(p.decisionMakers)} />
                </Field>
                <Field label="Problemas que resuelves">
                  <Textarea name="pains" defaultValue={join(p.pains)} />
                </Field>
              </div>
            </Section>

            <Section title="Objeciones" hint="Una por línea con el formato: objeción => cómo responder.">
              <Textarea
                name="objections"
                className="min-h-32"
                defaultValue={join(p.objections.map((o) => `${o.objection} => ${o.response}`))}
                placeholder="Es caro => Explicamos el ahorro de tiempo por operación"
              />
            </Section>

            <Section title="Cómo hablar">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tono">
                  <Textarea name="tone" defaultValue={p.tone} placeholder="Profesional, cercano y breve" />
                </Field>
                <Field label="Firma de los emails">
                  <Textarea name="signature" defaultValue={p.signature} />
                </Field>
              </div>
            </Section>
          </ActionForm>
        </Card>

        <Card
          title="Proponer con IA"
          description="Lee la descripción y el conocimiento del proyecto y rellena cliente ideal, problemas, objeciones y tono. Después revisa y guarda."
        >
          {isLlmConfigured() ? (
            <ModalButton
              label="Generar propuesta"
              icon={<Sparkles className="size-4" />}
              title="Proponer oferta y cliente con IA"
              description="Tarda unos segundos y sustituye lo que haya en esos apartados. La oferta y la firma no se tocan."
              variant="secondary"
            >
              <ActionForm
                action={draftOffer.bind(null, projectId)}
                submitLabel="Generar"
                className="space-y-4"
              >
                <Field label="Indicaciones (opcional)">
                  <Textarea
                    name="instructions"
                    placeholder="p. ej. Vendemos sobre todo a concesionarios multimarca"
                  />
                </Field>
              </ActionForm>
            </ModalButton>
          ) : (
            <p className="text-sm text-muted">Configura ANTHROPIC_API_KEY para usar la IA.</p>
          )}
        </Card>
      </div>
    </>
  );
}
