"use client";

import { ArrowUp, Sparkles, User } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { buttonClass } from "./ui";

/**
 * Chat building blocks (Copilot and any other conversation with an AI):
 * a panel with an optional toolbar, the message list and the composer.
 */
export function ChatPanel({
  toolbar,
  children,
  composer,
  className,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  composer: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx("flex flex-col overflow-hidden rounded-xl border border-border bg-surface", className)}
    >
      {toolbar ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-sm">
          {toolbar}
        </div>
      ) : null}
      {children}
      <div className="border-t border-border bg-surface p-3">{composer}</div>
    </div>
  );
}

/** The scrolling list of messages. It follows the conversation as it grows (`count`). */
export function ChatMessages({ children, count }: { children: ReactNode; count: number }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background/40 px-4 py-6">
      <div className="mx-auto max-w-3xl space-y-5">{children}</div>
      <div ref={end} />
    </div>
  );
}

function ChatAvatar({ from }: { from: "user" | "assistant" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4",
        from === "assistant" ? "bg-primary text-primary-foreground" : "bg-ink-100 text-ink-600",
      )}
    >
      {from === "assistant" ? <Sparkles /> : <User />}
    </span>
  );
}

/** One message. The assistant speaks on the left with its avatar; the user on the right. */
export function ChatMessage({
  from,
  children,
  footer,
  tone = "default",
}: {
  from: "user" | "assistant";
  children: ReactNode;
  /** Under the bubble: sources, proposed actions… */
  footer?: ReactNode;
  tone?: "default" | "danger";
}) {
  const mine = from === "user";
  return (
    <div className={cx("flex items-start gap-3", mine && "flex-row-reverse")}>
      <ChatAvatar from={from} />
      <div className={cx("min-w-0 max-w-[85%]", mine && "flex flex-col items-end")}>
        <div
          className={cx(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            mine
              ? "rounded-tr-md bg-primary whitespace-pre-wrap text-primary-foreground"
              : tone === "danger"
                ? "rounded-tl-md border border-danger/30 bg-danger/10 text-foreground"
                : "rounded-tl-md border border-border bg-surface text-foreground shadow-xs",
          )}
        >
          {children}
        </div>
        {footer ? <div className="mt-1.5 text-xs text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}

/** The assistant is writing. */
export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3" role="status" aria-label="Escribiendo">
      <ChatAvatar from="assistant" />
      <div className="flex h-10 items-center gap-1 rounded-2xl rounded-tl-md border border-border bg-surface px-4 shadow-xs">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="size-1.5 animate-bounce rounded-full bg-muted"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/** First screen of an empty conversation: what to ask, with ready-made questions. */
export function ChatWelcome({
  title,
  children,
  suggestions = [],
  onPick,
}: {
  title: string;
  children?: ReactNode;
  suggestions?: string[];
  onPick?: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center py-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Sparkles className="size-6" />
      </span>
      <p className="mt-4 text-base font-semibold">{title}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
      {suggestions.length ? (
        <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
          {suggestions.map((s) => (
            <SuggestionButton key={s} onClick={() => onPick?.(s)}>
              {s}
            </SuggestionButton>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SuggestionButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-sm transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-accent"
    >
      {children}
    </button>
  );
}

/**
 * Where the user writes. Enter sends, Shift+Enter adds a line; the box grows
 * with the text up to a few lines.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  pending = false,
  placeholder = "Escribe tu mensaje…",
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  pending?: boolean;
  placeholder?: string;
}) {
  const canSend = !pending && value.trim() !== "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend(value);
      }}
      className="mx-auto max-w-3xl"
    >
      <div className="flex items-end gap-2 rounded-xl border border-border bg-surface p-1.5 shadow-xs transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend(value);
            }
          }}
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm leading-5 outline-none [field-sizing:content] placeholder:text-muted/70"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Enviar"
          className={buttonClass({ variant: "primary", iconOnly: true })}
        >
          <ArrowUp />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-xs text-muted">Enter para enviar · Mayús + Enter para otra línea</p>
    </form>
  );
}

/**
 * The start of a conversation as the hero of a page (the home): a large
 * box to write in, with controls below it (e.g. which project) and ready-made
 * questions. Once the conversation starts, the page shows a `ChatPanel`.
 */
export function ChatHero({
  title,
  value,
  onChange,
  onSend,
  pending = false,
  placeholder = "Escribe tu mensaje…",
  controls,
  suggestions = [],
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string) => void;
  pending?: boolean;
  placeholder?: string;
  /** Next to the send button, e.g. a project selector. */
  controls?: ReactNode;
  suggestions?: string[];
}) {
  const canSend = !pending && value.trim() !== "";
  return (
    <div className="mx-auto max-w-3xl py-6">
      <h2 className="flex items-center justify-center gap-2 text-center font-display text-xl font-semibold tracking-tight">
        <Sparkles className="size-5 text-accent" aria-hidden />
        {title}
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) onSend(value);
        }}
        className="mt-5 rounded-2xl border border-border bg-surface p-3 shadow-sm transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 hover:border-border-strong"
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) onSend(value);
            }
          }}
          rows={3}
          placeholder={placeholder}
          aria-label={placeholder}
          className="block max-h-60 min-h-20 w-full resize-none bg-transparent px-1.5 py-1 text-base outline-none [field-sizing:content] placeholder:text-muted/70"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {controls}
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Enviar"
            className={cx(buttonClass({ variant: "primary", iconOnly: true }), "ml-auto")}
          >
            <ArrowUp />
          </button>
        </div>
      </form>
      {suggestions.length ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              disabled={pending}
              className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-ink-700 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-accent"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
