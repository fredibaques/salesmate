import { ClipboardType, FileInput as FileImportIcon, Upload } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { FileInput } from "@/components/file-input";
import { ModalButton } from "@/components/modal";
import { CardGrid, EntityCard, Field, Input, Meta, Textarea } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { importGoogleKnowledge, uploadKnowledge } from "./actions";
import { describeSource } from "./sources";

/**
 * The pieces of a knowledge screen, for the account's and a project's:
 * the ways to add knowledge and the cards of what's there.
 */

export function UploadButton({
  projectId,
  variant = "primary",
}: {
  projectId: string | null;
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
          <FileInput
            name="file"
            maxMb={4}
            accept=".csv,.tsv,.xlsx,.pdf,.docx,.md,.txt,.html"
            required
            className="file:mr-3 file:rounded-md file:border-0 file:bg-brand-100 file:px-2 file:py-1 file:text-accent hover:file:bg-brand-200"
          />
        </Field>
        <Field label="Nombre" optional hint="Si lo dejas vacío, se usa el nombre del fichero.">
          <Input name="name" />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

export function PasteButton({ projectId }: { projectId: string | null }) {
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

export function GoogleImportButton({ projectId }: { projectId: string | null }) {
  return (
    <ModalButton
      label="Desde Google"
      icon={<FileImportIcon className="size-4" />}
      title="Importar desde Google Docs o Sheets"
      variant="secondary"
    >
      <ActionForm
        action={importGoogleKnowledge.bind(null, projectId)}
        submitLabel="Importar"
        className="space-y-4"
      >
        <Field
          label="Enlace"
          hint="Un documento se añade como documento; una hoja, como tabla (su primera pestaña)."
          tip="Se importa una copia con la cuenta de Google conectada que tenga acceso. Si cambia en Google, vuelve a importarlo."
        >
          <Input name="url" type="url" required placeholder="https://docs.google.com/…" />
        </Field>
        <Field label="Nombre" optional hint="Si lo dejas vacío, se usa el título del fichero.">
          <Input name="name" />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}

/** Every way to add knowledge, in the order they show. */
export function AddKnowledge({ projectId }: { projectId: string | null }) {
  return (
    <>
      <PasteButton projectId={projectId} />
      <GoogleImportButton projectId={projectId} />
      <UploadButton projectId={projectId} />
    </>
  );
}

type SourceCard = {
  id: string;
  name: string;
  kind: "document" | "table" | "live" | "examples";
  description: string | null;
  createdAt: Date;
  projectId: string | null;
  tables: { name: string; rowCount: number }[];
  file: { filename: string; size: number } | null;
};

/** Where a source opens: under its project, or under the account's knowledge. */
export function sourceHref(s: { id: string; projectId: string | null }) {
  return s.projectId ? `/app/projects/${s.projectId}/knowledge/${s.id}` : `/app/knowledge/${s.id}`;
}

export function SourceCards({ sources }: { sources: SourceCard[] }) {
  return (
    <CardGrid>
      {sources.map((s) => {
        const kind = describeSource(s);
        const rows = s.tables.reduce((n, t) => n + t.rowCount, 0);
        return (
          <EntityCard
            key={s.id}
            href={sourceHref(s)}
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
              s.tables.length > 0 ? s.tables.map((t) => t.name).join(" · ") : (s.description ?? undefined)
            }
            footer={<span className="text-xs text-muted">Añadido el {formatDate(s.createdAt)}</span>}
          />
        );
      })}
    </CardGrid>
  );
}
