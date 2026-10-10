import Link from "next/link";
import { Field } from "@/components/ui";
import type { PlaybookWithSpec } from "@/server/playbooks/service";
import { NEXT_STEP_LABELS } from "@/server/playbooks/spec";

/** The project's sales process, as the agents that talk to people follow it, with a link to change it. */
export function ProcessField({
  projectId,
  process,
}: {
  projectId: string;
  process: PlaybookWithSpec | null;
}) {
  const steps = process?.spec.nextSteps ?? [];
  return (
    <Field
      label="Proceso de venta"
      tip="Es del proyecto: lo comparten todos los agentes que hablan con personas."
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="min-w-0">
          {process ? (
            <>
              {process.spec.objective || "Sin objetivo escrito"}
              {steps.length ? (
                <span className="block text-xs text-muted">
                  Termina en: {steps.map((s) => NEXT_STEP_LABELS[s].toLowerCase()).join(", o ")}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted">El proyecto todavía no tiene proceso de venta.</span>
          )}
        </span>
        <Link
          href={`/app/projects/${projectId}/sales/process`}
          className="text-sm text-accent hover:underline"
        >
          {process ? "Editar" : "Definirlo"}
        </Link>
      </div>
    </Field>
  );
}
