import { Field, Input, Select } from "./ui";

/** Fields shared by the global and per-project «Añadir exclusión» forms. */
export function SuppressionFields({ withScope = false }: { withScope?: boolean }) {
  return (
    <>
      <div className={withScope ? "grid gap-4 sm:grid-cols-2" : undefined}>
        <Field label="Tipo">
          <Select name="type" defaultValue="email">
            <option value="email">Email</option>
            <option value="domain">Dominio</option>
            <option value="phone">Teléfono</option>
          </Select>
        </Field>
        {withScope ? (
          <Field label="Ámbito">
            <Select name="scope" defaultValue="project">
              <option value="project">Solo este proyecto</option>
              <option value="global">Todos los proyectos</option>
            </Select>
          </Field>
        ) : null}
      </div>
      <Field label="Valores" hint="Uno o varios, separados por comas o espacios.">
        <Input name="values" required placeholder="nombre@empresa.com, competidor.com" />
      </Field>
      <Field label="Motivo">
        <Input name="reason" placeholder="p. ej. pidió la baja, cliente actual, competidor" />
      </Field>
    </>
  );
}

export const SUPPRESSION_TYPE_LABELS = { email: "Email", domain: "Dominio", phone: "Teléfono" } as const;
