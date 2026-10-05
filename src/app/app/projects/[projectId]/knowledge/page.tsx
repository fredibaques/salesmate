import { BookOpen, ClipboardType, ShieldCheck, Table2, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
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

function ReliabilityField() {
  return (
    <Field
      label="Fiabilidad"
      hint="Solo las fuentes de verdad pueden respaldar precios, plazos o condiciones en un mensaje."
    >
      <Select name="reliability" defaultValue="reference">
        <option value="reference">Orientativa (contexto)</option>
        <option value="truth">Fuente de verdad (precios, condiciones)</option>
      </Select>
    </Field>
  );
}

function UploadButton({
  projectId,
  variant = "primary",
}: {
  projectId: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <ModalButton
      label="Subir fichero"
      icon={<Upload className="size-4" />}
      title="Subir fichero"
      description="Excel y CSV se convierten en tablas consultables (tarifas, catálogos…). PDF, Word, Markdown y HTML se indexan como documentos."
      variant={variant}
    >
      <ActionForm action={uploadKnowledge.bind(null, projectId)} submitLabel="Subir" className="space-y-4">
        <input type="hidden" name="kind" value="document" />
        <Field label="Fichero">
          <Input
            name="file"
            type="file"
            accept=".csv,.tsv,.xlsx,.pdf,.docx,.md,.txt,.html"
            required
            className="file:mr-3 file:rounded-md file:border-0 file:bg-accent/10 file:px-2 file:py-1 file:text-accent hover:file:bg-accent/20"
          />
        </Field>
        <Field label="Nombre (opcional)" hint="Si lo dejas vacío, se usa el nombre del fichero.">
          <Input name="name" />
        </Field>
        <ReliabilityField />
      </ActionForm>
    </ModalButton>
  );
}

function PasteButton({ projectId }: { projectId: string }) {
  return (
    <ModalButton
      label="Pegar texto"
      icon={<ClipboardType className="size-4" />}
      title="Pegar texto"
      description="Objeciones, guiones, preguntas frecuentes o ejemplos de emails escritos directamente."
      variant="secondary"
      size="lg"
    >
      <ActionForm action={uploadKnowledge.bind(null, projectId)} submitLabel="Añadir" className="space-y-4">
        <input type="hidden" name="kind" value="text" />
        <Field label="Nombre">
          <Input name="name" required placeholder="p. ej. Respuestas a objeciones" />
        </Field>
        <Field label="Texto">
          <Textarea name="text" required className="min-h-56" />
        </Field>
        <ReliabilityField />
      </ActionForm>
    </ModalButton>
  );
}

export default async function KnowledgePage({ params }: PageProps<"/app/projects/[projectId]/knowledge">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const sources = await listKnowledge(getDb(), tenant, projectId);

  return (
    <div className="space-y-6">
      <Card
        title="Qué sabe el agente"
        description="Las fuentes de verdad son las únicas que pueden respaldar precios, plazos o condiciones en un mensaje. El resto sirve de contexto."
        actions={
          sources.length > 0 ? (
            <>
              <PasteButton projectId={projectId} />
              <UploadButton projectId={projectId} />
            </>
          ) : null
        }
      >
        {sources.length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            title="El agente todavía no sabe nada de este proyecto"
            description="Sube tus tarifas, presentaciones, condiciones o ejemplos de emails. Con eso responde con datos reales y cita de dónde los saca."
            action={
              <>
                <UploadButton projectId={projectId} />
                <PasteButton projectId={projectId} />
              </>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {sources.map((s) => (
              <li key={s.id} className="py-4 text-sm first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <Badge>{KIND_LABEL[s.kind]}</Badge>
                      <Badge tone={s.reliability === "truth" ? "success" : "neutral"}>
                        {s.reliability === "truth" ? "Fuente de verdad" : "Orientativa"}
                      </Badge>
                      {s.validatedAt ? (
                        <Badge tone="accent">Validada</Badge>
                      ) : (
                        <Badge tone="warning">Sin validar</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      Actualizada {formatDateTime(s.lastSyncedAt)}
                    </div>
                    {s.tables.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {s.tables.map((t) => (
                          <Link
                            key={t.id}
                            href={`/app/projects/${projectId}/knowledge/tables/${t.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs transition-colors hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
                          >
                            <Table2 className="size-3.5" />
                            {t.name} · {t.rowCount} filas
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <form
                      action={setSourceReliability.bind(
                        null,
                        projectId,
                        s.id,
                        s.reliability === "truth" ? "reference" : "truth",
                      )}
                    >
                      <Button variant="ghost">
                        {s.reliability === "truth"
                          ? "Marcar como orientativa"
                          : "Marcar como fuente de verdad"}
                      </Button>
                    </form>
                    <form action={validateSource.bind(null, projectId, s.id, !s.validatedAt)}>
                      <Button variant="ghost">
                        <ShieldCheck className="size-4" />
                        {s.validatedAt ? "Quitar validación" : "Validar"}
                      </Button>
                    </form>
                    <form action={removeSource.bind(null, projectId, s.id)}>
                      <Button variant="dangerGhost" aria-label={`Eliminar ${s.name}`}>
                        <Trash2 className="size-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {sources.length > 0 ? (
        <Card
          title="Pregúntale al conocimiento"
          description="Búsqueda en los documentos del proyecto, con la cita de cada fragmento."
        >
          <SearchBox action={searchProjectKnowledge.bind(null, projectId)} />
        </Card>
      ) : null}
    </div>
  );
}
