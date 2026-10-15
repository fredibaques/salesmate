"use client";

import { ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { ChatComposer, ChatMessage, ChatMessages, ChatWelcome, TypingIndicator } from "@/components/chat";
import { Drawer } from "@/components/drawer";
import { RichText } from "@/components/rich-text";
import { Button, buttonClass, Select } from "@/components/ui";
import { askFromPage, copilotPage } from "./actions";

type Turn = { role: "user" | "assistant"; content: string; actions?: number };
type Page = { label: string; projectId: string | null } | null;

/** Ready-made questions for what is on screen. */
function suggestionsFor(page: Page): string[] {
  if (page?.label.startsWith("Tabla"))
    return [
      "Resume esta tabla",
      "¿Qué columnas tienen más huecos y por qué?",
      "¿Qué filas parecen más prometedoras?",
      "¿Cómo mejoro las instrucciones de las columnas?",
    ];
  if (page?.label.startsWith("Agente"))
    return [
      "¿Cómo le han ido sus últimas ejecuciones?",
      "¿Por qué no encuentra lo que le pido?",
      "¿Cómo mejoro sus instrucciones?",
      "¿Cuánto está gastando?",
    ];
  return [
    "¿Qué contactos esperan nuestra respuesta?",
    "Resume nuestra propuesta de valor en tres frases",
    "¿Qué respondemos si nos dicen que es caro?",
    "Prepárame la llamada con el último contacto",
  ];
}

/**
 * The Copilot from any page: a button in the top bar that opens it in a
 * side panel. It knows what is on screen (a table, an agent, a project) and
 * answers from that page's project. The conversation stays while the panel
 * is closed, until «Nueva conversación».
 */
export function CopilotPanel({ projects }: { projects: { id: string; name: string }[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const projectId =
    chosen ??
    (page?.projectId && projects.some((p) => p.id === page.projectId) ? page.projectId : null) ??
    projects[0]?.id ??
    "";

  function openPanel() {
    setOpen(true);
    copilotPage(pathname)
      .then(setPage)
      .catch(() => setPage(null));
  }

  function send(question: string) {
    if (!question.trim() || !projectId) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setDraft("");
    setError(null);
    start(async () => {
      const reply = await askFromPage(projectId, pathname, history, question);
      if (reply.ok)
        setTurns((t) => [...t, { role: "assistant", content: reply.answer, actions: reply.actions }]);
      else setError(reply.error);
    });
  }

  const reset = () => {
    setTurns([]);
    setError(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        aria-label="Preguntar al Copilot"
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        <Sparkles />
        <span className="hidden sm:inline">Copilot</span>
      </button>
      {open ? (
        <Drawer
          title="Copilot"
          subtitle={page ? `Viendo: ${page.label}` : "Pregunta sobre tu oferta, tus tablas o tus agentes"}
          icon={<Sparkles />}
          onClose={() => setOpen(false)}
          flush
        >
          {projects.length ? (
            <>
              {projects.length > 1 || turns.length ? (
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm sm:px-6">
                  {projects.length > 1 ? (
                    <>
                      <span className="text-muted">Proyecto</span>
                      <Select
                        size="sm"
                        value={projectId}
                        onChange={(e) => {
                          setChosen(e.target.value);
                          reset();
                        }}
                        className="w-48"
                        aria-label="Proyecto"
                      >
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : null}
                  {turns.length ? (
                    <Button variant="ghost" size="sm" onClick={reset} className="ml-auto">
                      <RotateCcw />
                      Nueva conversación
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <ChatMessages count={turns.length + (pending ? 1 : 0) + (error ? 1 : 0)}>
                {turns.length === 0 && !pending && !error ? (
                  <ChatWelcome
                    title={page ? "¿En qué te ayudo con esta pantalla?" : "¿En qué te ayudo?"}
                    suggestions={suggestionsFor(page)}
                    onPick={send}
                  >
                    {page ? `Sé que estás viendo: ${page.label}.` : null}
                  </ChatWelcome>
                ) : null}
                {turns.map((t, i) =>
                  t.role === "user" ? (
                    <ChatMessage key={i} from="user">
                      {t.content}
                    </ChatMessage>
                  ) : (
                    <ChatMessage
                      key={i}
                      from="assistant"
                      footer={
                        t.actions ? (
                          <Link
                            href="/app/inbox"
                            onClick={() => setOpen(false)}
                            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                          >
                            {t.actions === 1 ? "1 acción propuesta" : `${t.actions} acciones propuestas`}:
                            revisar en «Por aprobar»
                            <ArrowRight className="size-3.5" />
                          </Link>
                        ) : null
                      }
                    >
                      <RichText text={t.content} />
                    </ChatMessage>
                  ),
                )}
                {pending ? <TypingIndicator /> : null}
                {error ? (
                  <ChatMessage from="assistant" tone="danger">
                    {error}
                  </ChatMessage>
                ) : null}
              </ChatMessages>
              <div className="border-t border-border bg-surface p-3">
                <ChatComposer
                  value={draft}
                  onChange={setDraft}
                  onSend={send}
                  pending={pending}
                  placeholder="Pregunta sobre esta página…"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted">
              El Copilot responde con el conocimiento de un proyecto: crea uno para empezar.
              <Link href="/app/projects/new" className={buttonClass({ size: "sm" })}>
                Crear proyecto
              </Link>
            </div>
          )}
        </Drawer>
      ) : null}
    </>
  );
}
