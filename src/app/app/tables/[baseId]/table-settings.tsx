import { Settings2, Trash2, Webhook } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { ModalButton } from "@/components/modal";
import { Button, Field, Input, Select } from "@/components/ui";
import { deleteBaseAction, intakeAction, moveBaseAction, renameBaseAction } from "../actions";

/** The table's name, its project (or none) and deleting it. */
export function TableSettings({
  baseId,
  name,
  rows,
  agents,
  projectId,
  projects,
}: {
  baseId: string;
  name: string;
  rows: number;
  agents: number;
  projectId: string | null;
  projects: { id: string; name: string }[];
}) {
  return (
    <ModalButton
      label="Ajustes de la tabla"
      icon={<Settings2 className="size-4" />}
      title="Ajustes de la tabla"
      variant="ghost"
      iconOnly
    >
      <ActionForm action={renameBaseAction.bind(null, baseId)} submitLabel="Guardar" className="space-y-4">
        <Field label="Nombre">
          <Input name="name" required maxLength={120} defaultValue={name} />
        </Field>
      </ActionForm>
      <div className="mt-6 border-t border-border pt-5">
        <ActionForm
          action={moveBaseAction.bind(null, baseId)}
          submitLabel="Guardar"
          submitVariant="secondary"
          cancel={false}
          className="space-y-4"
        >
          <Field
            label="Proyecto"
            tip="Una tabla puede ir sola o con un proyecto. Sus agentes pueden trabajar en las tablas del proyecto y en las que no tienen."
          >
            <Select name="projectId" defaultValue={projectId ?? ""}>
              <option value="">Sin proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
      </div>
      <div className="mt-6 space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Borrar la tabla</h3>
        <ConfirmForm
          action={deleteBaseAction.bind(null, baseId)}
          message={`¿Borrar «${name}» y sus ${rows} filas? No se puede deshacer.${agents ? " El agente que la rellena pasará a otra tabla de su proyecto." : ""}`}
        >
          <Button variant="danger" size="sm">
            <Trash2 className="size-4" />
            Borrar la tabla y sus {rows} filas
          </Button>
        </ConfirmForm>
      </div>
    </ModalButton>
  );
}

/**
 * A web form (or any tool that can POST) adds rows to this table: its
 * address, its key and the field names that match each column.
 */
export function TableIntake({
  baseId,
  intakeKey,
  appUrl,
  person,
  columns,
}: {
  baseId: string;
  intakeKey: string | null;
  appUrl: string;
  person: boolean;
  columns: { name: string }[];
}) {
  const endpoint = `${appUrl}/api/tables/${baseId}/rows`;
  const fixed = person ? ["nombre", "empresa", "web"] : ["empresa", "web"];
  const example = `<form action="${endpoint}" method="POST">
  <input type="hidden" name="_key" value="${intakeKey ?? "…"}">
  <input type="hidden" name="_redirect" value="https://tu-web.com/gracias">
  <input type="text" name="_gotcha" style="display:none">
${[...fixed, ...columns.slice(0, 4).map((c) => c.name)].map((n) => `  <input name="${n}" placeholder="${n}">`).join("\n")}
  <button>Enviar</button>
</form>`;
  return (
    <ModalButton
      label={intakeKey ? "Formulario conectado" : "Conectar formulario"}
      icon={<Webhook className="size-4" />}
      title="Rellenar la tabla desde un formulario"
      variant="ghost"
      width="lg"
    >
      {intakeKey ? (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Cada envío crea una fila. Los campos se emparejan con las columnas por su nombre; además se
            reconocen {fixed.join(", ")}, email y teléfono.
          </p>
          <div>
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Dirección (POST)</span>
            <code className="mt-1 block rounded-lg bg-background p-2 text-xs break-all">{endpoint}</code>
          </div>
          <div>
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Clave</span>
            <code className="mt-1 block rounded-lg bg-background p-2 text-xs break-all">{intakeKey}</code>
          </div>
          <div>
            <span className="text-xs font-medium tracking-wide text-muted uppercase">Nombres de campo</span>
            <p className="mt-1 text-xs break-words text-muted">
              {[...fixed, "email", "telefono", ...columns.map((c) => c.name)].join(" · ")}
            </p>
          </div>
          <details>
            <summary className="text-accent hover:underline">Ejemplo de formulario HTML</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-background p-3 text-xs">{example}</pre>
          </details>
          <p className="text-xs text-muted">
            También vale JSON, con la clave en la cabecera <code>x-salesmate-key</code> (Zapier, Make, tu
            backend…).
          </p>
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <ActionForm
              action={intakeAction.bind(null, baseId, true)}
              submitLabel="Cambiar la clave"
              submitVariant="secondary"
              cancel={false}
              stayOpen
              confirm="La clave actual dejará de funcionar en tus formularios. ¿Seguir?"
            />
            <ActionForm
              action={intakeAction.bind(null, baseId, false)}
              submitLabel="Desconectar"
              submitVariant="ghost"
              cancel={false}
              confirm="Los formularios dejarán de añadir filas. ¿Seguir?"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <p className="text-muted">
            Conecta el formulario de tu web (o Zapier, Make, tu backend…): cada envío crea una fila en esta
            tabla. Te daremos una dirección y una clave solo para ella.
          </p>
          <ActionForm action={intakeAction.bind(null, baseId, true)} submitLabel="Activar" stayOpen />
        </div>
      )}
    </ModalButton>
  );
}
