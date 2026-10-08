import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ActionForm, type FormState } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { Field, Input } from "@/components/ui";
import { getAuth } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/session";
import { runForm, str } from "@/server/form";
import { slugifyKey } from "@/server/knowledge/normalize";
import { getDb } from "@/server/db/client";
import { invitationsFor } from "@/server/services/team";
import { acceptInvitationAction } from "../invite/[id]/actions";

export const metadata = { title: "Bienvenida" };

async function createOrganization(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  await requireUser();
  const result = await runForm(async () => {
    const name = str(form, "name");
    if (!name || name.length < 2) throw new Error("Escribe un nombre de al menos 2 caracteres.");
    const slug = `${slugifyKey(name).replace(/_/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;
    const org = await getAuth().api.createOrganization({ headers: await headers(), body: { name, slug } });
    if (!org) throw new Error("No se ha podido crear la organización.");
    await getAuth().api.setActiveOrganization({ headers: await headers(), body: { organizationId: org.id } });
  });
  if (result?.ok) redirect("/app");
  return result;
}

export default async function OnboardingPage() {
  const session = await requireUser();
  const invitations = await invitationsFor(getDb(), session.user.email);
  return (
    <div className="mx-auto mt-24 w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
      <Logo size={36} className="mb-5" />
      <h1 className="text-xl font-semibold">Hola, {session.user.name}</h1>
      <p className="mt-2 text-sm text-muted">
        Crea tu organización. Dentro podrás dar de alta todos tus proyectos (empresas, marcas o tu actividad
        como autónomo) y, si quieres, invitar a otras personas.
      </p>
      {invitations.length ? (
        <div className="mt-6 space-y-3">
          <h2 className="text-sm font-medium">Te han invitado</h2>
          {invitations.map((i) => (
            <div
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="text-sm font-medium">{i.organizationName}</span>
              <ActionForm
                action={acceptInvitationAction.bind(null, i.id)}
                submitLabel="Unirme"
                className="flex items-center gap-2"
              />
            </div>
          ))}
          <h2 className="pt-3 text-sm font-medium">O crea la tuya</h2>
        </div>
      ) : null}
      <ActionForm action={createOrganization} submitLabel="Crear organización" className="mt-6 space-y-4">
        <Field label="Nombre de la organización">
          <Input name="name" required placeholder="p. ej. Mis negocios" />
        </Field>
      </ActionForm>
    </div>
  );
}
