"use client";

import { useActionState } from "react";
import type { SearchState } from "../actions";

export function SearchBox({
  action,
}: {
  action: (state: SearchState, form: FormData) => Promise<SearchState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <div>
      <form action={formAction} className="flex gap-2">
        <input
          name="q"
          placeholder="p. ej. ¿qué respondemos si dicen que es caro?"
          defaultValue={state?.query}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground"
        >
          {pending ? "…" : "Buscar"}
        </button>
      </form>
      {state ? (
        state.hits.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Sin resultados para «{state.query}».</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {state.hits.map((h) => (
              <li key={h.chunkId} className="rounded-lg border border-border p-3 text-sm">
                <div className="mb-1 text-xs text-muted">
                  {h.sourceName} · fragmento {h.position + 1} ·{" "}
                  {h.reliability === "truth" ? "fuente de verdad" : "orientativa"}
                </div>
                <p className="whitespace-pre-wrap">{h.content}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
