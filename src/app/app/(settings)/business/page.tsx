import { ActionForm } from "@/components/action-form";
import { Card, FormSection } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getBusinessProfile } from "@/server/services/business";
import { CustomerFields, OfferFields, VoiceFields } from "../../projects/profile-fields";
import { saveBusinessAction } from "./actions";

export const metadata = { title: "Tu negocio" };

/** What the business sells, to whom and how it talks: the same for every project. */
export default async function BusinessPage() {
  const tenant = await requireTenant();
  const profile = await getBusinessProfile(getDb(), tenant);
  return (
    <div className="max-w-3xl">
      <Card
        title="Tu negocio"
        tip="Lo que todos tus proyectos y sus agentes necesitan saber de tu negocio: qué vendes, a quién y cómo hablar. Cada proyecto añade su objetivo y, si quiere, acota a quién va dirigido."
      >
        <ActionForm
          key={JSON.stringify(profile)}
          action={saveBusinessAction}
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
  );
}
