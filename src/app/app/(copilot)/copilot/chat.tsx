"use client";

import { ArrowRight, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  ChatComposer,
  ChatMessage,
  ChatMessages,
  ChatPanel,
  ChatWelcome,
  TypingIndicator,
} from "@/components/chat";
import { RichText } from "@/components/rich-text";
import { Button, InfoTip, Select } from "@/components/ui";
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
    <ChatPanel
      className="h-[calc(100vh-12rem)] min-h-96"
      toolbar={
        <>
          <span className="text-muted">Proyecto</span>
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
          <InfoTip>
            Responde con el conocimiento del proyecto y cita sus fuentes. Lo que proponga hacer (un email, una
            tarea…) espera tu aprobación en «Por aprobar».
          </InfoTip>
          {turns.length ? (
            <Button variant="ghost" size="sm" onClick={() => setTurns([])} className="ml-auto">
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
        {turns.length === 0 ? (
          <ChatWelcome title="¿En qué te ayudo?" suggestions={SUGGESTIONS} onPick={send}>
            Pregunta sobre tu oferta, tus tarifas o tus contactos, o pide que prepare un email o una tarea.
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
