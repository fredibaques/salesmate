import { Building2, Undo2, User, X } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Drawer } from "@/components/drawer";
import { Badge, Button, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { BaseColumn } from "@/lib/prospect-columns";
import type { CellMeta } from "@/server/db/schema";
import type { ProspectBase } from "@/server/prospects/bases";
import type { ProspectRow } from "@/server/prospects/service";
import { changeProspectStatus, saveRowAction } from "../actions";
import { COLUMN_ICONS } from "../column-icons";

/** Where a value comes from, under its field. */
function provenance(column: BaseColumn, meta: CellMeta | undefined) {
  if (meta?.by === "agent") return `Lo encontró el agente · ${formatDateTime(meta.at)}`;
  if (meta?.by === "user") return `Escrito a mano · ${formatDateTime(meta.at)}`;
  if (column.filledBy === "person") return "La rellena el equipo";
  return column.instructions;
}

/** The control for one column, by its type. Its name is `f:<column id>`. */
function CellInput({ column, value }: { column: BaseColumn; value: unknown }) {
  const name = `f:${column.id}`;
  const text = value === null || value === undefined ? "" : String(value);
  switch (column.type) {
    case "long":
      return <Textarea name={name} defaultValue={text} className="min-h-24" />;
    case "number":
      return <Input name={name} type="number" step="any" defaultValue={text} />;
    case "score":
      return (
        <Input name={name} type="number" min={0} max={100} step={1} defaultValue={text} className="w-32" />
      );
    case "date":
      return <Input name={name} type="date" defaultValue={text} className="w-48" />;
    case "bool":
      return (
        <Select
          name={name}
          defaultValue={value === true ? "sí" : value === false ? "no" : ""}
          className="w-40"
        >
          <option value="">—</option>
          <option value="sí">Sí</option>
          <option value="no">No</option>
        </Select>
      );
    case "select":
      return (
        <Select name={name} defaultValue={text}>
          <option value="">—</option>
          {/* A value kept from before the options changed still shows. */}
          {text && !(column.options ?? []).includes(text) ? <option value={text}>{text}</option> : null}
          {(column.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    case "multi": {
      const picked = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(column.options ?? []).map((o) => (
            <Chip key={o} name={name} value={o} defaultChecked={picked.includes(o)}>
              {o}
            </Chip>
          ))}
        </div>
      );
    }
    case "email":
      return <Input name={name} type="email" defaultValue={text} />;
    case "phone":
      return <Input name={name} type="tel" defaultValue={text} />;
    case "url":
      return <Input name={name} inputMode="url" defaultValue={text} placeholder="https://" />;
    default:
      return <Input name={name} defaultValue={text} />;
  }
}

const STATUS = {
  new: { label: "Nuevo", tone: "accent" },
  accepted: { label: "Nuevo", tone: "accent" },
  exported: { label: "Exportado", tone: "neutral" },
  discarded: { label: "Descartado", tone: "warning" },
} as const;

/**
 * A row of the base in a side panel: every value with where it comes from,
 * editable by any member. Without `row`, the same form adds a row by hand.
 */
export function RowPanel({
  projectId,
  base,
  row,
  closeHref,
}: {
  projectId: string;
  base: ProspectBase;
  row: ProspectRow | null;
  closeHref: string;
}) {
  const person = base.rowKind === "person";
  const title = row ? (person ? (row.personName ?? row.companyName) : row.companyName) : "Nueva fila";
  return (
    <Drawer
      title={title}
      icon={person ? <User /> : <Building2 />}
      closeHref={closeHref}
      subtitle={
        row ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[row.status].tone}>{STATUS[row.status].label}</Badge>
            {person ? row.companyName : null}
            <span>
              {row.runId ? "Encontrada por el agente" : "Añadida"} el {formatDateTime(row.createdAt)}
            </span>
          </span>
        ) : (
          `En «${base.name}»`
        )
      }
    >
      <ActionForm
        action={saveRowAction.bind(null, projectId, base.id, row?.id ?? null)}
        submitLabel={row ? "Guardar" : "Añadir fila"}
        className="space-y-5"
      >
        {person ? (
          <Field label="Nombre">
            <Input name="personName" required defaultValue={row?.personName ?? ""} />
          </Field>
        ) : null}
        <Field label={person ? "Empresa" : "Nombre de la empresa"}>
          <Input name="companyName" required defaultValue={row?.companyName ?? ""} />
        </Field>
        <Field label="Web" optional>
          <Input name="website" inputMode="url" defaultValue={row?.website ?? ""} placeholder="https://" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field label="Encaje" optional tip="De 0 a 100: cuánto se parece a tu cliente ideal.">
            <Input
              name="fitScore"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={row?.fitScore ?? ""}
            />
          </Field>
          <Field label="Por qué encaja" optional>
            <Input name="fitReason" defaultValue={row?.fitReason ?? ""} />
          </Field>
        </div>

        {base.columns.length ? (
          <div className="space-y-5 border-t border-border pt-5">
            {base.columns.map((c) => {
              const Icon = COLUMN_ICONS[c.type];
              return (
                <Field
                  key={c.id}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="size-3.5 text-muted" aria-hidden />
                      {c.name}
                    </span>
                  }
                  group={c.type === "multi"}
                  hint={row ? provenance(c, row.cellMeta[c.id]) : c.instructions}
                >
                  <CellInput column={c} value={row?.data[c.id]} />
                </Field>
              );
            })}
          </div>
        ) : null}

        {row?.sources.length ? (
          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-medium">Fuentes</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {row.sources.map((src) => (
                <li key={src} className="truncate">
                  <a href={src} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    {src}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </ActionForm>

      {row ? (
        <form
          action={changeProspectStatus.bind(
            null,
            projectId,
            base.id,
            [row.id],
            row.status === "discarded" ? "new" : "discarded",
          )}
          className="mt-6 border-t border-border pt-4"
        >
          {row.status === "discarded" ? (
            <Button variant="ghost" size="sm">
              <Undo2 className="size-4" />
              Recuperar
            </Button>
          ) : (
            <Button variant="dangerGhost" size="sm">
              <X className="size-4" />
              Descartar
            </Button>
          )}
        </form>
      ) : null}
    </Drawer>
  );
}
