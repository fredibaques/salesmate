import { redirect } from "next/navigation";
import { ActionForm, type FormState } from "@/components/action-form";
import { Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm, str } from "@/server/form";
import { createProject } from "@/server/services/projects";

export const metadata = { title: "Nuevo proyecto" };

async function create(_: FormState, form: FormData): Promise<FormState> {
  "use server";
  let id: string | undefined;
  const result = await runForm(async () => {
    const tenant = await requireRole(["owner", "admin"]);
    const project = await createProject(getDb(), tenant, {
      name: str(form, "name") ?? "",
      description: str(form, "description"),
      website: str(form, "website") ?? "",
      timezone: str(form, "timezone") ?? "Europe/Madrid",
      languages: (str(form, "languages") ?? "es")
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    });
    id = project.id;
  });
  if (id) redirect(`/app/projects/${id}`);
  return result;
}

export default function NewProjectPage() {
  return (
    <>
      <PageHeader
        title="Nuevo proyecto"
        description="Un proyecto es una empresa, una marca o tu actividad como autónomo. Cada uno tiene su oferta, sus herramientas, su conocimiento y sus reglas, aislados del resto."
      />
      <Card className="max-w-2xl">
        <ActionForm action={create} submitLabel="Crear proyecto" className="space-y-4">
          <Field label="Nombre">
            <Input name="name" required minLength={2} />
          </Field>
          <Field label="Descripción" hint="Qué vendes y a quién, en dos líneas.">
            <Textarea name="description" />
          </Field>
          <Field label="Web">
            <Input name="website" type="url" placeholder="https://" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Zona horaria">
              <Input name="timezone" defaultValue="Europe/Madrid" />
            </Field>
            <Field label="Idiomas" hint="Separados por comas, p. ej. es, en">
              <Input name="languages" defaultValue="es" />
            </Field>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
