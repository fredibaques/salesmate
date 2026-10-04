import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, EmptyState, Field, Input, Select, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listKnowledge } from "@/server/services/projects";
import {
  removeSource,
  searchProjectKnowledge,
  setSourceReliability,
  uploadKnowledge,
  validateSource,
} from "../actions";
import { SearchBox } from "./search-box";

const KIND_LABEL = {
  document: "Documento",
  table: "Tabla",
  live: "Fuente viva",
  examples: "Ejemplos",
} as const;

export default async function KnowledgePage({ params }: PageProps<"/app/projects/[projectId]/knowledge">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const sources = await listKnowledge(getDb(), tenant, projectId);

  return (
    <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
      <div className="space-y-6">
        <Card
          title="Qué sabe el agente"
          description="Las fuentes de verdad son las únicas que pueden respaldar precios, plazos o condiciones en un mensaje. El resto sirve de contexto."
        >
          {sources.length === 0 ? (
            <EmptyState>Sube tus tarifas, presentaciones, objeciones o ejemplos de emails.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {sources.map((s) => (
                <li key={s.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{s.name}</span>
                    <span className="flex flex-wrap gap-2">
                      <Badge>{KIND_LABEL[s.kind]}</Badge>
                      <Badge tone={s.reliability === "truth" ? "success" : "neutral"}>
                        {s.reliability === "truth" ? "Fuente de verdad" : "Orientativa"}
                      </Badge>
                      {s.validatedAt ? (
                        <Badge tone="accent">Validada</Badge>
                      ) : (
                        <Badge tone="warning">Sin validar</Badge>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted">Actualizada {formatDateTime(s.lastSyncedAt)}</div>
                  {s.tables.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      {s.tables.map((t) => (
                        <Link
                          key={t.id}
                          href={`/app/projects/${projectId}/knowledge/tables/${t.id}`}
                          className="text-accent"
                        >
                          {t.name} ({t.rowCount} filas)
                        </Link>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form
                      action={setSourceReliability.bind(
                        null,
                        projectId,
                        s.id,
                        s.reliability === "truth" ? "reference" : "truth",
                      )}
                    >
                      <Button variant="secondary">
                        {s.reliability === "truth"
                          ? "Marcar como orientativa"
                          : "Marcar como fuente de verdad"}
                      </Button>
                    </form>
                    <form action={validateSource.bind(null, projectId, s.id, !s.validatedAt)}>
                      <Button variant="secondary">{s.validatedAt ? "Quitar validación" : "Validar"}</Button>
                    </form>
                    <form action={removeSource.bind(null, projectId, s.id)}>
                      <Button variant="ghost" className="text-danger">
                        Eliminar
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Pregúntale al conocimiento"
          description="Búsqueda en los documentos del proyecto, con la cita de cada fragmento."
        >
          <SearchBox action={searchProjectKnowledge.bind(null, projectId)} />
        </Card>
      </div>

      <div className="space-y-6">
        <Card
          title="Subir fichero"
          description="Excel/CSV se convierten en tablas consultables. PDF, Word, Markdown y HTML se indexan como documentos."
        >
          <ActionForm
            action={uploadKnowledge.bind(null, projectId)}
            submitLabel="Subir"
            className="space-y-4"
          >
            <input type="hidden" name="kind" value="document" />
            <Field label="Fichero">
              <Input name="file" type="file" accept=".csv,.tsv,.xlsx,.pdf,.docx,.md,.txt,.html" required />
            </Field>
            <Field label="Nombre (opcional)">
              <Input name="name" />
            </Field>
            <Field label="Fiabilidad">
              <Select name="reliability" defaultValue="reference">
                <option value="reference">Orientativa (contexto)</option>
                <option value="truth">Fuente de verdad (precios, condiciones)</option>
              </Select>
            </Field>
          </ActionForm>
        </Card>

        <Card title="Pegar texto" description="Objeciones, guiones, FAQ… escritos directamente.">
          <ActionForm
            action={uploadKnowledge.bind(null, projectId)}
            submitLabel="Añadir"
            className="space-y-4"
          >
            <input type="hidden" name="kind" value="text" />
            <Field label="Nombre">
              <Input name="name" required />
            </Field>
            <Field label="Texto">
              <Textarea name="text" required className="min-h-40" />
            </Field>
            <Field label="Fiabilidad">
              <Select name="reliability" defaultValue="reference">
                <option value="reference">Orientativa</option>
                <option value="truth">Fuente de verdad</option>
              </Select>
            </Field>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
