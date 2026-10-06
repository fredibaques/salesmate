import { Download, Info, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { ConfirmForm } from "@/components/confirm-form";
import { Button, buttonClass, Card, Meta, PageHeader, Table, Td } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSourceDetail, queryTable } from "@/server/knowledge/service";
import { formatCell } from "@/server/knowledge/tabular";
import { removeSource } from "../../actions";
import { describeSource } from "../sources";

const MAX_ROWS = 200;

export default async function SourcePage({
  params,
}: PageProps<"/app/projects/[projectId]/knowledge/[sourceId]">) {
  const { projectId, sourceId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const detail = await getSourceDetail(db, tenant, sourceId).catch(() => null);
  if (!detail || detail.source.projectId !== projectId) notFound();
  const { source, file, tables, text } = detail;
  const kind = describeSource({ kind: source.kind, file });
  const fileUrl = `/app/projects/${projectId}/knowledge/${sourceId}/file`;
  const isPdf = file?.mimeType === "application/pdf";
  const wasPdf = !file && /\.pdf$/i.test(String(source.exposedObjects.filename ?? ""));
  const notes = (source.exposedObjects.notes as string[] | undefined) ?? [];
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
            <ConfirmForm
              action={removeSource.bind(null, projectId, sourceId)}
              message={`¿Eliminar «${source.name}»? Los agentes dejarán de usarlo.`}
            >
              <Button variant="dangerGhost">
                <Trash2 className="size-4" />
                Eliminar
              </Button>
            </ConfirmForm>
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
