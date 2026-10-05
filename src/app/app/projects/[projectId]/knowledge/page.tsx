import { BookOpen, ClipboardType, Upload } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import {
  Card,
  CardGrid,
  EmptyState,
  EntityCard,
  Field,
  Input,
  Meta,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listKnowledge } from "@/server/services/projects";
import { askKnowledge, uploadKnowledge } from "../actions";
import { AskBox } from "./ask-box";
import { describeSource } from "./sources";
import { KnowledgeNav } from "../section-navs";

export const metadata = { title: "Conocimiento" };

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
      variant={variant}
    >
      <ActionForm action={uploadKnowledge.bind(null, projectId)} submitLabel="Subir" className="space-y-4">
        <input type="hidden" name="kind" value="document" />
        <Field label="Fichero" hint="Hasta 4 MB.">
          <Input
            name="file"
            type="file"
            accept=".csv,.tsv,.xlsx,.pdf,.docx,.md,.txt,.html"
            required
            className="file:mr-3 file:rounded-md file:border-0 file:bg-accent/10 file:px-2 file:py-1 file:text-accent hover:file:bg-accent/20"
          />
        </Field>
        <Field label="Nombre" optional hint="Si lo dejas vacío, se usa el nombre del fichero.">
          <Input name="name" />
        </Field>
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
      variant="secondary"
      width="lg"
    >
      <ActionForm action={uploadKnowledge.bind(null, projectId)} submitLabel="Añadir" className="space-y-4">
        <input type="hidden" name="kind" value="text" />
        <Field label="Nombre">
          <Input name="name" required placeholder="p. ej. Respuestas a objeciones" />
        </Field>
        <Field label="Texto">
          <Textarea name="text" required className="min-h-56" />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

export default async function KnowledgePage({ params }: PageProps<"/app/projects/[projectId]/knowledge">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const sources = await listKnowledge(getDb(), tenant, projectId);

  return (
    <>
      <KnowledgeNav projectId={projectId} />
      <PageHeader
        level="section"
        title="Documentos y tablas"
        tip="Todo lo que subas aquí lo usan los agentes para responder con datos reales y decir de dónde los sacan. Si algo cambia, sube la versión nueva y borra la antigua."
        actions={
          sources.length > 0 ? (
            <>
              <PasteButton projectId={projectId} />
              <UploadButton projectId={projectId} />
            </>
          ) : null
        }
      />

      {sources.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="Los agentes todavía no saben nada de este proyecto"
          description="Sube tus tarifas, presentaciones, condiciones o ejemplos de emails. Con eso responden con datos reales y citan de dónde los sacan."
          action={
            <>
              <UploadButton projectId={projectId} />
              <PasteButton projectId={projectId} />
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          <Card
            title="Pregúntale al conocimiento"
            tip="Comprueba qué respondería un agente: contesta solo con lo que has subido y te dice de dónde sale."
          >
            <AskBox projectId={projectId} action={askKnowledge.bind(null, projectId)} />
          </Card>

          <CardGrid>
            {sources.map((s) => {
              const kind = describeSource(s);
              const rows = s.tables.reduce((n, t) => n + t.rowCount, 0);
              return (
                <EntityCard
                  key={s.id}
                  href={`/app/projects/${projectId}/knowledge/${s.id}`}
                  icon={kind.icon}
                  title={s.name}
                  meta={
                    <Meta
                      items={[
                        kind.label,
                        s.tables.length > 0
                          ? `${s.tables.length === 1 ? "1 tabla" : `${s.tables.length} tablas`}, ${rows} filas`
                          : kind.detail,
                      ]}
                    />
                  }
                  description={
                    s.tables.length > 0
                      ? s.tables.map((t) => t.name).join(" · ")
                      : (s.description ?? undefined)
                  }
                  footer={<span className="text-xs text-muted">Añadido el {formatDate(s.createdAt)}</span>}
                />
              );
            })}
          </CardGrid>
        </div>
      )}
    </>
  );
}
