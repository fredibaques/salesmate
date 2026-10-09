"use client";

import { Hand, Lock, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { ActionForm, type FormAction, type FormState } from "@/components/action-form";
import { useToast } from "@/components/toast";
import { buttonClass, cx, Input, Textarea } from "@/components/ui";
import type { PersonChange } from "@/server/conversations/inbox";
import type { WhatsappTemplate } from "@/server/connectors/whatsapp";

export { AutoRefresh } from "@/components/auto-refresh";

/** Keeps the thread scrolled to its latest message (on opening it and when one arrives). */
export function ScrollToEnd({ count }: { count: number }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return <div ref={end} />;
}

/** A filter that applies as soon as it changes (submits its form). */
export function SubmitOnChange({
  name,
  defaultValue,
  options,
  "aria-label": label,
}: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  "aria-label": string;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className="h-8 max-w-28 shrink-0 rounded-md border border-border bg-surface px-2 text-xs text-ink-700 transition-colors hover:border-border-strong"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Take over from the agent / give it back, close / reopen. */
export function PersonButtons({
  handedOff,
  closed,
  change,
}: {
  handedOff: boolean;
  closed: boolean;
  change: (change: PersonChange) => Promise<FormState>;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = (c: PersonChange) =>
    start(async () => {
      const result = await change(c);
      if (result) toast?.(result);
    });
  return (
    <span className="flex flex-wrap items-center gap-1">
      {closed ? null : handedOff ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run("give_back")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          title="El agente vuelve a responder a esta persona"
        >
          <Undo2 />
          Devolver al agente
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => run("take_over")}
          className={buttonClass({ variant: "secondary", size: "sm" })}
          title="La llevas tú: el agente guarda sus mensajes pero no responde"
        >
          <Hand />
          Tomar el control
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(closed ? "reopen" : "close")}
        className={buttonClass({ variant: "ghost", size: "sm" })}
      >
        {closed ? <RotateCcw /> : <Lock />}
        {closed ? "Reabrir" : "Cerrar"}
      </button>
    </span>
  );
}

type Channel = "email" | "whatsapp";

/**
 * The box at the foot of the thread: answer by email or WhatsApp (sent
 * through the gateway, as the person), or leave a note for the team.
 */
export function Composer({
  channels,
  preferred,
  subject,
  reply,
  note,
  templates,
}: {
  channels: { email: { from: string } | null; whatsapp: { from: string; windowOpen: boolean } | null };
  preferred: Channel | null;
  subject: string;
  reply: FormAction;
  note: FormAction;
  templates: () => Promise<{ ok: true; templates: WhatsappTemplate[] } | { ok: false; message: string }>;
}) {
  const [mode, setMode] = useState<"reply" | "note">(preferred ? "reply" : "note");
  const [channel, setChannel] = useState<Channel>(preferred ?? "email");
  const available = (["email", "whatsapp"] as const).filter((c) => channels[c]);
  const whatsappClosed = channel === "whatsapp" && channels.whatsapp && !channels.whatsapp.windowOpen;

  const tab = (key: "reply" | "note", label: string) => (
    <button
      type="button"
      onClick={() => setMode(key)}
      className={cx(
        "rounded-md px-2.5 py-1 text-sm transition-colors",
        mode === key ? "bg-surface font-medium shadow-xs" : "text-ink-700 hover:bg-ink-100",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className={cx("border-t border-border p-3", mode === "note" && "bg-amber-50")}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-ink-50 p-1">
          {tab("reply", "Responder")}
          {tab("note", "Nota interna")}
        </div>
        {mode === "reply" && available.length > 1 ? (
          <div className="flex gap-1 rounded-lg bg-ink-50 p-1" role="radiogroup" aria-label="Canal">
            {available.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={channel === c}
                onClick={() => setChannel(c)}
                className={cx(
                  "rounded-md px-2.5 py-1 text-sm transition-colors",
                  channel === c ? "bg-surface font-medium shadow-xs" : "text-ink-700 hover:bg-ink-100",
                )}
              >
                {c === "email" ? "Email" : "WhatsApp"}
              </button>
            ))}
          </div>
        ) : null}
        {mode === "reply" && channels[channel] ? (
          <span className="text-xs text-muted">desde {channels[channel]!.from}</span>
        ) : null}
      </div>

      {mode === "note" ? (
        <ActionForm action={note} submitLabel="Guardar nota" submitVariant="secondary" className="space-y-2">
          <Textarea
            name="body"
            required
            rows={2}
            placeholder="Solo la ve tu equipo: contexto, lo que has hablado por teléfono…"
            className="min-h-16"
          />
        </ActionForm>
      ) : available.length === 0 ? (
        <p className="py-2 text-sm text-muted">
          Para responder desde aquí, conecta un buzón o un número de WhatsApp y asígnalo al proyecto en los
          canales de su agente. Mientras, puedes dejar notas para el equipo.
        </p>
      ) : whatsappClosed ? (
        <TemplatePicker reply={reply} load={templates} />
      ) : (
        <ActionForm action={reply} submitLabel="Enviar" className="space-y-2" key={channel}>
          <input type="hidden" name="channel" value={channel} />
          {channel === "email" ? (
            <Input name="subject" defaultValue={subject} placeholder="Asunto" aria-label="Asunto" size="sm" />
          ) : null}
          <Textarea
            name="body"
            required
            rows={3}
            placeholder={channel === "email" ? "Escribe tu respuesta…" : "Escribe el WhatsApp…"}
            className="min-h-20"
          />
        </ActionForm>
      )}
    </div>
  );
}

/**
 * After 24 h without a WhatsApp from them (or if they never wrote by
 * WhatsApp), only an approved template can be sent: pick one and fill its
 * gaps, seeing what they will read.
 */
function TemplatePicker({
  reply,
  load,
}: {
  reply: FormAction;
  load: () => Promise<{ ok: true; templates: WhatsappTemplate[] } | { ok: false; message: string }>;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; templates: WhatsappTemplate[] }
  >({ status: "idle" });
  const [picked, setPicked] = useState(0);
  const [params, setParams] = useState<string[]>([]);

  if (state.status !== "ready") {
    return (
      <div className="space-y-2 py-1 text-sm">
        <p className="text-muted">
          Han pasado más de 24 horas desde su último WhatsApp (o nunca te ha escrito por ahí): WhatsApp solo
          deja escribirle con una plantilla aprobada por Meta.
        </p>
        {state.status === "error" ? <p className="text-danger">{state.message}</p> : null}
        <button
          type="button"
          disabled={state.status === "loading"}
          onClick={async () => {
            setState({ status: "loading" });
            const result = await load();
            setState(
              result.ok
                ? { status: "ready", templates: result.templates }
                : { status: "error", message: result.message },
            );
          }}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {state.status === "loading" ? "Cargando plantillas…" : "Usar una plantilla"}
        </button>
      </div>
    );
  }
  if (!state.templates.length) {
    return (
      <p className="py-2 text-sm text-muted">Tu cuenta de WhatsApp no tiene plantillas aprobadas todavía.</p>
    );
  }
  const t = state.templates[picked] ?? state.templates[0];
  const preview = t.body.replace(/\{\{(\d+)\}\}/g, (all, n) => params[Number(n) - 1] || all);
  return (
    <ActionForm
      action={reply}
      submitLabel="Enviar plantilla"
      className="space-y-2"
      key={`${t.name}:${t.language}`}
    >
      <input type="hidden" name="channel" value="whatsapp" />
      <input type="hidden" name="templateName" value={t.name} />
      <input type="hidden" name="templateLanguage" value={t.language} />
      <select
        aria-label="Plantilla"
        value={picked}
        onChange={(e) => {
          setPicked(Number(e.target.value));
          setParams([]);
        }}
        className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm transition-colors hover:border-border-strong"
      >
        {state.templates.map((x, i) => (
          <option key={`${x.name}:${x.language}`} value={i}>
            {x.name} · {x.language}
          </option>
        ))}
      </select>
      {Array.from({ length: t.params }, (_, i) => (
        <Input
          key={i}
          name="param"
          required
          size="sm"
          placeholder={`Hueco {{${i + 1}}}`}
          aria-label={`Hueco ${i + 1}`}
          onChange={(e) => {
            const next = [...params];
            next[i] = e.target.value;
            setParams(next);
          }}
        />
      ))}
      <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm whitespace-pre-wrap text-ink-700">
        {preview || t.name}
      </p>
    </ActionForm>
  );
}
