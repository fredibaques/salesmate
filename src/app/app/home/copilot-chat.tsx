"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import {
  ChatComposer,
  ChatHero,
  ChatMessage,
  ChatMessages,
  ChatPanel,
  TypingIndicator,
} from "@/components/chat";
import { RichText } from "@/components/rich-text";
import { Button, InfoTip, Select } from "@/components/ui";
import { ask } from "./copilot-actions";

type Turn = { role: "user" | "assistant"; content: string; actions?: number };

const SUGGESTIONS = [
  "¿Qué contactos esperan nuestra respuesta?",
  "Resume nuestra propuesta de valor en tres frases",
  "¿Qué respondemos si nos dicen que es caro?",
  "Prepárame la llamada con el último contacto",
];

/**
 * Copilot on the home page: a large box to ask, with the rest of the home
 * (`children`) below it. Once a conversation starts it takes the page, until
 * «Nueva conversación».
 */
export function CopilotChat({
  title,
  projects,
  unavailable,
  shortcuts,
  children,
}: {
  title: ReactNode;
  projects: { id: string; name: string }[];
  /** Why it can't answer yet (no AI connected, no project), with the fix. */
  unavailable?: ReactNode;
  /** Other ways to start, under the box. */
  shortcuts?: ReactNode;
  children?: ReactNode;
}) {
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

  const projectSelect = (
    <Select
      size="sm"
      value={projectId}
      onChange={(e) => {
        setProjectId(e.target.value);
        setTurns([]);
      }}
      className="w-56"
      aria-label="Proyecto"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );

  if (turns.length === 0 && !pending && !error) {
    return (
      <>
        <ChatHero
          title={title}
          notice={unavailable}
          disabled={Boolean(unavailable)}
          footer={shortcuts}
          value={draft}
          onChange={setDraft}
          onSend={send}
          pending={pending}
          placeholder="Pregunta sobre tu oferta, tus tarifas o tus contactos, o pide que prepare un email o una tarea…"
          controls={
            projects.length === 0 ? null : (
              <>
                {projectSelect}
                <InfoTip>
                  Responde con el conocimiento del proyecto y cita sus fuentes. Lo que proponga hacer (un
                  email, una tarea…) espera tu aprobación en «Por aprobar».
                </InfoTip>
              </>
            )
          }
          suggestions={SUGGESTIONS}
        />
        {children}
      </>
    );
  }

  return (
    <ChatPanel
      className="h-[calc(100vh-9rem)] min-h-96"
      toolbar={
        <>
          <span className="text-muted">Proyecto</span>
          {projectSelect}
          <InfoTip>
            Responde con el conocimiento del proyecto y cita sus fuentes. Lo que proponga hacer (un email, una
            tarea…) espera tu aprobación en «Por aprobar».
          </InfoTip>
          {turns.length ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTurns([]);
                setError(null);
              }}
              className="ml-auto"
            >
              <RotateCcw />
              Nueva conversación
            </Button>
          ) : null}
        </>
      }
      composer={
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={send}
          pending={pending}
          placeholder="Pregunta sobre tu oferta, tus tarifas o tus contactos…"
        />
      }
    >
      <ChatMessages count={turns.length + (pending ? 1 : 0) + (error ? 1 : 0)}>
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
                    className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
                  >
                    {t.actions === 1 ? "1 acción propuesta" : `${t.actions} acciones propuestas`}: revisar en
                    «Por aprobar»
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
    </ChatPanel>
  );
}
