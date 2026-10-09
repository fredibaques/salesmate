import { ArrowRightLeft, Download, Info, Pencil, Trash2 } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ConfirmForm } from "@/components/confirm-form";
import { Select } from "@/components/form-controls";
import { ModalButton } from "@/components/modal";
import {
  Button,
  buttonClass,
  Card,
  Field,
  Input,
  Meta,
  PageHeader,
  Table,
  Td,
  Textarea,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { TenantContext } from "@/server/db/tenant";
import { getDb } from "@/server/db/client";
import { getSourceDetail, isEditableText, queryTable } from "@/server/knowledge/service";
import { formatCell } from "@/server/knowledge/tabular";
import { listProjects } from "@/server/services/projects";
import { editSourceText, moveSourceAction, removeSource } from "./actions";
import { describeSource } from "./sources";

const MAX_ROWS = 200;

type Detail = NonNullable<Awaited<ReturnType<typeof getSourceDetail>>>;

/** A knowledge source as people see it: the file, its tables or its text. */
export async function SourceDetail({
  tenant,
  detail,
}: {
  tenant: Pick<TenantContext, "orgId"> & { role: string };
  detail: Detail;
}) {
  const db = getDb();
  const { source, file, tables, text } = detail;
  const sourceId = source.id;
  const canEdit = tenant.role !== "member";
  const projects = canEdit ? await listProjects(db, tenant) : [];
  const kind = describeSource({ kind: source.kind, file });
  const fileUrl = `/app/knowledge/${sourceId}/file`;
  const isPdf = file?.mimeType === "application/pdf";
  const wasPdf = !file && /\.pdf$/i.test(String(source.exposedObjects.filename ?? ""));
  const notes = (source.exposedObjects.notes as string[] | undefined) ?? [];
  const editable = canEdit && isEditableText(source, file);
  const tableRows = await Promise.all(
    tables.map((t) => queryTable(db, tenant, { tableId: t.id, limit: MAX_ROWS })),
  );

  return (
    <>
      <PageHeader
        icon={kind.icon}
        title={source.name}
        badge={
          <span className="text-sm text-muted">
            <Meta items={[kind.label, kind.detail, `añadido el ${formatDate(source.createdAt)}`]} />
          </span>
        }
        actions={
          <>
            {editable ? (
              <ModalButton
                label="Editar"
                icon={<Pencil className="size-4" />}
                title={`Editar «${source.name}»`}
                width="xl"
              >
                <ActionForm
                  key={text}
                  action={editSourceText.bind(null, sourceId)}
                  submitLabel="Guardar"
                  className="space-y-4"
                >
                  <Field label="Nombre">
                    <Input name="name" required defaultValue={source.name} />
                  </Field>
                  <Field
                    label="Texto"
                    hint={file ? "Al guardar, este texto sustituye al fichero original." : undefined}
                  >
                    <Textarea name="text" required defaultValue={text} className="min-h-[50vh]" />
                  </Field>
                </ActionForm>
              </ModalButton>
            ) : null}
            {canEdit ? (
              <ConfirmForm
                action={removeSource.bind(null, sourceId)}
                message={`¿Eliminar «${source.name}»? Los agentes dejarán de usarlo.`}
              >
                <Button variant="dangerGhost">
                  <Trash2 className="size-4" />
                  Eliminar
                </Button>
              </ConfirmForm>
            ) : null}
            {canEdit ? (
              <ModalButton
                label="Mover"
                icon={<ArrowRightLeft className="size-4" />}
                title={`Mover «${source.name}»`}
                variant="secondary"
              >
                <ActionForm
                  action={moveSourceAction.bind(null, sourceId)}
                  submitLabel="Mover"
                  className="space-y-4"
                >
                  <Field
                    label="Quién lo usa"
                    tip="Lo de toda la cuenta lo usan los agentes de todos los proyectos; lo de un proyecto, solo los suyos."
                  >
                    <Select name="projectId" defaultValue={source.projectId ?? ""}>
                      <option value="">Toda la cuenta</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          Solo el proyecto {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </ActionForm>
              </ModalButton>
            ) : null}
            {file ? (
              <a href={`${fileUrl}?download`} className={buttonClass({ variant: "secondary" })}>
                <Download className="size-4" />
                Descargar original
              </a>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        {isPdf ? (
          <iframe
            src={fileUrl}
            title={source.name}
            className="h-[78vh] w-full rounded-xl border border-border bg-surface"
          />
        ) : null}

        {wasPdf ? (
          <p className="flex items-start gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
            Este PDF se subió antes de que guardáramos los originales, así que no podemos mostrarlo tal cual.
            Si quieres verlo aquí, vuelve a subirlo y borra este. Debajo tienes el texto que leen los agentes.
          </p>
        ) : null}

        {tables.map((table, i) => {
          const result = tableRows[i];
          return (
            <Card key={table.id} title={table.name} tip={table.description}>
              <Table head={table.columns.map((c) => c.label)}>
                {result.rows.map((r) => (
                  <tr key={r.id}>
                    {table.columns.map((c) => (
                      <Td
                        key={c.key}
                        className={
                          c.type === "number" || c.type === "integer" ? "text-right tabular-nums" : undefined
                        }
                      >
                        {formatCell(r.data[c.key] as never) || <span className="text-muted">—</span>}
                      </Td>
                    ))}
                  </tr>
                ))}
              </Table>
              {table.rowCount > MAX_ROWS ? (
                <p className="mt-2 text-xs text-muted">
                  Mostrando las primeras {MAX_ROWS} de {table.rowCount} filas. Los agentes consultan todas.
                </p>
              ) : null}
            </Card>
          );
        })}

        {notes.length > 0 ? (
          <Card
            title="Notas de la hoja"
            tip="Texto que acompaña a las tablas; los agentes también lo tienen en cuenta."
          >
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        {source.kind !== "table" && text ? (
          isPdf ? (
            <details className="group rounded-xl border border-border bg-surface p-5">
              <summary className="text-sm font-semibold">Texto que leen los agentes</summary>
              <p className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">
                {text}
              </p>
            </details>
          ) : (
            <Card title={wasPdf ? "Texto que leen los agentes" : "Contenido"}>
              <p className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
            </Card>
          )
        ) : null}
      </div>
    </>
  );
}
