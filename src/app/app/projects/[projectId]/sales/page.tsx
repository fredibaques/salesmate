import { Sparkles } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Card, Field, FormSection, Notice, Textarea } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSalesProfile } from "@/server/services/agents";
import { currentAi } from "../../../ai-notice";
import { CustomerFields, OfferFields, VoiceFields } from "../../profile-fields";
import { draftOffer, saveOffer } from "../offer/actions";
import { SalesNav } from "../section-navs";

export const metadata = { title: "Oferta y cliente" };

/** What the project sells, to whom and how to talk to them: every agent of the project knows it. */
export default async function ProjectOfferPage({ params }: PageProps<"/app/projects/[projectId]/sales">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [profile, ai] = await Promise.all([getSalesProfile(db, tenant, projectId), currentAi()]);

  return (
    <>
      <SalesNav projectId={projectId} />
      <div className="max-w-3xl">
        <Card
          title="Oferta y cliente"
          tip="Lo que todos los agentes de este proyecto necesitan saber de tu venta: qué ofreces, a quién y cómo hablarle. Cómo vende cada conversación está en «Proceso de venta»; lo propio de cada agente, en su ficha."
          actions={
            ai ? (
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
      </div>
    </>
  );
}
