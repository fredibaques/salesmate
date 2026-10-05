"use client";

import { ArrowUp, FileText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { RichText } from "@/components/rich-text";
import { buttonBase, buttonStyles, cx } from "@/components/ui";
import type { AskState } from "../actions";

const EXAMPLES = ["¿Cuánto cuesta el servicio principal?", "¿Qué condiciones de pago hay?"];

/** Ask the project's knowledge a question and get a direct answer with its sources. */
export function AskBox({
  projectId,
  action,
}: {
  projectId: string;
  action: (state: AskState, form: FormData) => Promise<AskState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <div>
      <form action={formAction} className="flex gap-2">
        <input
          name="q"
          required
          autoComplete="off"
          placeholder="Pregunta lo que le preguntaría un cliente, p. ej. ¿cuánto cuesta…?"
          defaultValue={state?.question}
          key={state?.question}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          disabled={pending}
          className={cx(buttonBase, buttonStyles.primary, "shrink-0")}
          aria-label="Preguntar"
        >
          <ArrowUp className="size-4" />
          <span className="hidden sm:inline">Preguntar</span>
        </button>
      </form>

      {pending ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Sparkles className="size-4 animate-pulse text-accent" />
          Buscando en tu conocimiento…
        </p>
      ) : state && "error" in state ? (
        <p className="mt-4 text-sm text-danger">{state.error}</p>
      ) : state ? (
        <div className="mt-4 rounded-lg border border-border bg-background/60 p-4">
          <RichText text={state.answer} />
          {state.sources.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted">
              Sacado de:
              {state.sources.map((s) => (
                <Link
                  key={s.id}
                  href={`/app/projects/${projectId}/knowledge/${s.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-foreground transition-colors hover:border-accent/50 hover:text-accent"
                >
                  <FileText className="size-3.5" />
                  {s.name}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Por ejemplo: {EXAMPLES.map((e) => `«${e}»`).join(" o ")}</p>
      )}
    </div>
  );
}
