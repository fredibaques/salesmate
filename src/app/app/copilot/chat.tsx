"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ask } from "./actions";

type Turn = { role: "user" | "assistant"; content: string; actions?: number };

const SUGGESTIONS = [
  "¿Qué contactos esperan nuestra respuesta?",
  "Resume nuestra propuesta de valor en tres frases",
  "¿Qué respondemos si nos dicen que es caro?",
  "Prepárame la llamada con el último contacto",
];

export function CopilotChat({ projects }: { projects: { id: string; name: string }[] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(question: string) {
    if (!question.trim() || !projectId) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setDraft("");
    setError(null);
    start(async () => {
      const reply = await ask(projectId, history, question);
      if (reply.ok)
        setTurns((t) => [...t, { role: "assistant", content: reply.answer, actions: reply.actions }]);
      else setError(reply.error);
    });
  }

  return (
    <div className="flex h-[calc(100vh-12rem)] flex-col rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border p-3 text-sm">
        <span className="text-muted">Proyecto</span>
        <select
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setTurns([]);
          }}
          className="rounded-lg border border-border bg-surface px-2 py-1"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {turns.length ? (
          <button
            onClick={() => setTurns([])}
            className="ml-auto rounded-lg px-2 py-1 text-muted transition-colors hover:bg-background hover:text-foreground"
          >
            Nueva conversación
          </button>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xl text-center">
            <p className="text-sm text-muted">
              Pregunta sobre tu oferta, tus tarifas, tus contactos o pide que prepare un email o una tarea.
              Responde con el conocimiento del proyecto y cita sus fuentes; lo que proponga hacer pasa por tu
              bandeja.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent/50 hover:bg-accent/5 hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "ml-auto max-w-2xl" : "max-w-3xl"}>
            <div
              className={`whitespace-pre-wrap rounded-xl px-4 py-2 text-sm ${
                t.role === "user" ? "bg-accent text-accent-foreground" : "bg-background"
              }`}
            >
              {t.content}
            </div>
            {t.actions ? (
              <Link href="/app/inbox" className="mt-1 block text-xs text-accent hover:underline">
                {t.actions} acción(es) propuesta(s) → revisar en la bandeja
              </Link>
            ) : null}
          </div>
        ))}
        {pending ? <div className="text-sm text-muted">Pensando…</div> : null}
        {error ? <div className="text-sm text-danger">{error}</div> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="flex gap-2 border-t border-border p-3"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={2}
          placeholder="Escribe tu pregunta…"
          className="flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          disabled={pending || !draft.trim()}
          className="rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
