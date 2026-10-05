"use client";

import { useState } from "react";
import {
  ChatComposer,
  ChatMessage,
  ChatMessages,
  ChatPanel,
  ChatWelcome,
  TypingIndicator,
} from "@/components/chat";
import { RichText } from "@/components/rich-text";

/** The chat components with sample content (nothing is sent). */
export function ChatDemo() {
  const [draft, setDraft] = useState("");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChatPanel
        className="h-[28rem]"
        composer={<ChatComposer value={draft} onChange={setDraft} onSend={() => setDraft("")} />}
      >
        <ChatMessages count={0}>
          <ChatWelcome
            title="¿En qué te ayudo?"
            suggestions={["¿Cuánto cuesta una transferencia?", "Resume la oferta"]}
          />
        </ChatMessages>
      </ChatPanel>
      <ChatPanel
        className="h-[28rem]"
        toolbar={<span className="text-muted">Barra de herramientas</span>}
        composer={<ChatComposer value="" onChange={() => {}} onSend={() => {}} pending />}
      >
        <ChatMessages count={0}>
          <ChatMessage from="user">¿Cuánto cuesta una transferencia de un turismo?</ChatMessage>
          <ChatMessage from="assistant" footer="Fuente: Tarifas 2026">
            <RichText
              text={
                "La transferencia de un **turismo** cuesta **89 €** con IVA.\n\n- Incluye la gestión en la DGT\n- No incluye el impuesto (ITP)"
              }
            />
          </ChatMessage>
          <ChatMessage from="assistant" tone="danger">
            No he podido responder. Inténtalo de nuevo.
          </ChatMessage>
          <TypingIndicator />
        </ChatMessages>
      </ChatPanel>
    </div>
  );
}
