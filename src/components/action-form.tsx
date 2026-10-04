"use client";

import { useActionState, type ReactNode } from "react";

export type FormState = { ok: boolean; message: string } | null;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Form bound to a server action that returns a status message.
 * Keeps the page usable without client-side state management.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = "primary",
  className,
  confirm,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  submitVariant?: "primary" | "secondary" | "danger";
  className?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const variants = {
    primary: "bg-accent text-accent-foreground hover:opacity-90",
    secondary: "border border-border bg-surface hover:bg-background",
    danger: "bg-danger text-white hover:opacity-90",
  };
  return (
    <form
      action={formAction}
      className={className ?? "space-y-3"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${variants[submitVariant]}`}
        >
          {pending ? "…" : submitLabel}
        </button>
        {state ? (
          <span role="status" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
