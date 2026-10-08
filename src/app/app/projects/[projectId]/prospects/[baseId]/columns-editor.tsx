import {
  ChevronDown,
  ChevronUp,
  Columns3,
  Eye,
  EyeOff,
  Lock,
  Pencil,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { ModalButton } from "@/components/modal";
import { Button, Field, Input } from "@/components/ui";
import { COLUMN_TYPE_LABELS, type BaseColumn } from "@/lib/prospect-columns";
import {
  deleteBaseAction,
  moveColumnAction,
  removeColumnAction,
  renameBaseAction,
  saveColumnAction,
  toggleColumnAction,
} from "../actions";
import { COLUMN_ICONS } from "../column-icons";
import { ColumnForm } from "../column-form";

const FILLED_BY_LABELS = {
  agent: "La rellena el agente",
  person: "La rellena una persona",
  both: "Agente y personas",
};

type Ids = { projectId: string; baseId: string };

/** Opens the form to add a column. */
export function AddColumnButton({
  projectId,
  baseId,
  variant = "secondary",
  iconOnly = false,
}: Ids & { variant?: "secondary" | "ghost"; iconOnly?: boolean }) {
  return (
    <ModalButton
      label="Añadir columna"
      icon={<Plus className="size-4" />}
      title="Nueva columna"
      variant={variant}
      size="sm"
      iconOnly={iconOnly}
    >
      <ColumnForm action={saveColumnAction.bind(null, projectId, baseId, null)} />
    </ModalButton>
  );
}

/** Opens the form to change one column, with the option to delete it. */
export function EditColumnButton({
  projectId,
  baseId,
  column,
  className,
}: Ids & { column: BaseColumn; className?: string }) {
  return (
    <ModalButton
      label={`Editar «${column.name}»`}
      icon={<Pencil className="size-3.5" />}
      title={`Editar «${column.name}»`}
      variant="ghost"
      size="sm"
      iconOnly
      className={className}
    >
      <ColumnForm action={saveColumnAction.bind(null, projectId, baseId, column.id)} column={column} />
      <div className="mt-5 border-t border-border pt-4">
        <ConfirmForm
          action={removeColumnAction.bind(null, projectId, baseId, column.id)}
          message={`¿Borrar la columna «${column.name}» y todos sus valores? No se puede deshacer.`}
        >
          <Button variant="dangerGhost" size="sm">
            <Trash2 className="size-4" />
            Borrar columna
          </Button>
        </ConfirmForm>
      </div>
    </ModalButton>
  );
}

/** All the columns of a base: order, visibility in the table, edit and add. */
export function ColumnsEditor({
  projectId,
  baseId,
  columns,
  person = false,
}: Ids & { columns: BaseColumn[]; person?: boolean }) {
  const fixedColumns = person
    ? "Nombre, empresa, web, encaje, estado y fuentes"
    : "Empresa, web, encaje, estado y fuentes";
  return (
    <ModalButton
      label="Columnas"
      icon={<Columns3 className="size-4" />}
      title="Columnas"
      variant="ghost"
      size="sm"
      width="lg"
    >
      <ul className="divide-y divide-border rounded-lg border border-border">
        <li className="flex items-center gap-3 px-3 py-2">
          <Lock className="size-4 shrink-0 text-muted" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{fixedColumns}</div>
            <div className="truncate text-xs text-muted">
              Siempre están: identifican la fila y justifican lo que guarda el agente
            </div>
          </div>
        </li>
        {columns.map((c, i) => {
          const Icon = COLUMN_ICONS[c.type];
          return (
            <li key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-ink-25">
              <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div
                  className={
                    c.hidden ? "truncate text-sm text-muted line-through" : "truncate text-sm font-medium"
                  }
                >
                  {c.name}
                </div>
                <div className="truncate text-xs text-muted">
                  {COLUMN_TYPE_LABELS[c.type]} · {FILLED_BY_LABELS[c.filledBy]}
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <form action={moveColumnAction.bind(null, projectId, baseId, c.id, -1)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    disabled={i === 0}
                    aria-label={`Subir «${c.name}»`}
                    title="Mover a la izquierda"
                  >
                    <ChevronUp className="size-4" />
                  </Button>
                </form>
                <form action={moveColumnAction.bind(null, projectId, baseId, c.id, 1)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    disabled={i === columns.length - 1}
                    aria-label={`Bajar «${c.name}»`}
                    title="Mover a la derecha"
                  >
                    <ChevronDown className="size-4" />
                  </Button>
                </form>
                <form action={toggleColumnAction.bind(null, projectId, baseId, c.id, !c.hidden)}>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={c.hidden ? `Mostrar «${c.name}»` : `Ocultar «${c.name}»`}
                    title={
                      c.hidden ? "Mostrar en la tabla" : "Ocultar en la tabla (sus valores se conservan)"
                    }
                  >
                    {c.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </form>
                <EditColumnButton projectId={projectId} baseId={baseId} column={c} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        <AddColumnButton projectId={projectId} baseId={baseId} />
      </div>
    </ModalButton>
  );
}

/** Name of the base and deleting it. */
export function BaseSettings({
  projectId,
  baseId,
  name,
  rows,
  agents,
}: Ids & { name: string; rows: number; agents: number }) {
  return (
    <ModalButton
      label="Ajustes de la tabla"
      icon={<Settings2 className="size-4" />}
      title="Ajustes de la tabla"
      variant="ghost"
      iconOnly
    >
      <ActionForm
        action={renameBaseAction.bind(null, projectId, baseId)}
        submitLabel="Guardar"
        className="space-y-4"
      >
        <Field label="Nombre">
          <Input name="name" required maxLength={120} defaultValue={name} />
        </Field>
      </ActionForm>
      <div className="mt-6 space-y-3 border-t border-border pt-5">
        <h3 className="text-sm font-medium">Borrar la tabla</h3>
        <ConfirmForm
          action={deleteBaseAction.bind(null, projectId, baseId)}
          message={`¿Borrar «${name}» y sus ${rows} filas? No se puede deshacer.${agents ? " El agente que la rellena pasará a otra tabla del proyecto." : ""}`}
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
