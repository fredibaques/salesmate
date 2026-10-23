import { Settings2, Trash2, Webhook } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { ModalButton } from "@/components/modal";
import { Button, Field, Input } from "@/components/ui";
import { deleteBaseAction, intakeAction, moveBaseAction, renameBaseAction } from "../actions";
import { ProjectsScope } from "./projects-scope";
import { formatDateTime } from "@/lib/format";
import { INTAKE_OUTCOME_LABELS, type IntakeAttempt } from "@/lib/intake-attempts";

/** The table's name, the projects that use it and deleting it. */
export function TableSettings({
  baseId,
  name,
  rows,
  agents,
  projectId,
  projectIds,
  projects,
  linked,
}: {
  baseId: string;
  name: string;
  rows: number;
  agents: number;
  projectId: string | null;
  /** The projects it is shared with, when it isn't one project's. */
  projectIds: string[];
  projects: { id: string; name: string }[];
  /** Rows of other tables that belong to its rows, by table: deleting it deletes them. */
  linked: { name: string; n: number }[];
}) {
  const linkedRows = linked.reduce((n, l) => n + l.n, 0);
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
            label="Proyectos que la usan"
            group
            tip="Los agentes de esos proyectos pueden trabajar en ella y la ven en su menú. Los datos de cada fila (y su fase) son los mismos para todos."
          >
            <ProjectsScope projects={projects} picked={projectId ? [projectId] : projectIds} />
          </Field>
        </ActionForm>
      </div>
      <div className="mt-6 space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Borrar la tabla</h3>
        <ConfirmForm
          action={deleteBaseAction.bind(null, baseId)}
          message={`¿Borrar «${name}» y sus ${rows} filas?${linkedRows ? ` También se borrarán ${linkedRows} filas relacionadas con ellas (${linked.map((l) => `${l.n} en «${l.name}»`).join(", ")}).` : ""} No se puede deshacer.${agents ? " El agente que la rellena pasará a otra tabla de su proyecto." : ""}`}
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
  attempts = [],
}: {
  baseId: string;
  intakeKey: string | null;
  appUrl: string;
  person: boolean;
  columns: { name: string }[];
  /** The last submissions that didn't add a row, newest first. */
  attempts?: IntakeAttempt[];
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
            También vale JSON (Zapier, Make, tu backend…), con la clave en la cabecera{" "}
            <code>x-salesmate-key</code> o <code>Authorization: Bearer</code>, o en un campo <code>key</code>.
          </p>
          <IntakeAttempts attempts={attempts} />
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
          <IntakeAttempts attempts={attempts} />
        </div>
      )}
    </ModalButton>
  );
}

/** The last submissions to the form address that didn't add a row, with why. */
function IntakeAttempts({ attempts }: { attempts: IntakeAttempt[] }) {
  if (!attempts.length) return null;
  return (
    <div className="border-t border-border pt-4">
      <h3 className="text-sm font-medium">Últimos envíos que no han entrado</h3>
      <ul className="mt-2 space-y-2">
        {attempts.slice(0, 10).map((a, i) => (
          <li key={`${a.at}-${i}`} className="text-xs">
            <span className="text-muted tabular-nums">{formatDateTime(new Date(a.at))}</span>
            {" · "}
            {INTAKE_OUTCOME_LABELS[a.outcome]}
            {a.message ? <span className="block text-muted">{a.message}</span> : null}
            {a.fields?.length ? (
              <span className="block break-words text-muted">Campos: {a.fields.join(", ")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
