import { Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Field, Input, Textarea, type ButtonVariant } from "@/components/ui";
import { createProjectAction } from "./actions";

export const PROJECT_HELP =
  "Un proyecto es una empresa, una marca o tu actividad como autónomo. Cada uno tiene su oferta, sus herramientas, su conocimiento y sus reglas, aislados del resto.";

export function NewProjectFields() {
  return (
    <>
      <Field label="Nombre">
        <Input name="name" required minLength={2} placeholder="p. ej. Swipoo" />
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
    </>
  );
}

/** «Nuevo proyecto» button that opens the creation form in a modal. */
export function NewProjectButton({
  variant = "primary",
  className,
  label = "Nuevo proyecto",
}: {
  variant?: ButtonVariant;
  className?: string;
  label?: string;
}) {
  return (
    <ModalButton
      label={label}
      icon={<Plus className="size-4" />}
      title="Nuevo proyecto"
      description={PROJECT_HELP}
      variant={variant}
      className={className}
    >
      <ActionForm action={createProjectAction} submitLabel="Crear proyecto" className="space-y-4">
        <NewProjectFields />
      </ActionForm>
    </ModalButton>
  );
}
