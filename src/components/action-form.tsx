"use client";

import { useActionState, type ReactNode } from "react";
import { useModal } from "./modal";
import { useToast } from "./toast";
import { buttonBase, buttonStyles, cx } from "./ui";

export type FormState = { ok: boolean; message: string } | null;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Form bound to a server action that returns a status message.
 * Inside a modal it adds «Cancelar», and on success closes the modal and
 * shows the message as a toast; elsewhere the message appears next to the
 * button.
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
  const modal = useModal();
  const toast = useToast();
  // In a modal, react as soon as the server answers: the refreshed page may
  // move or remove the button that opened it (e.g. the first item replaces
  // an empty state), unmounting this form before an effect could run.
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    modal
      ? async (prev, formData) => {
          const result = await action(prev, formData);
          if (result?.ok) {
            toast?.({ ok: true, message: result.message });
            modal.close();
          }
          return result;
        }
      : action,
    null,
  );

  const inlineStatus = state && !(modal && state.ok);

  return (
    <form
      action={formAction}
      className={className ?? "space-y-3"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div
        className={cx("flex flex-wrap items-center gap-3", modal && "flex-row-reverse justify-start pt-2")}
      >
        <button type="submit" disabled={pending} className={cx(buttonBase, buttonStyles[submitVariant])}>
          {pending ? "Un momento…" : submitLabel}
        </button>
        {modal ? (
          <button type="button" onClick={modal.close} className={cx(buttonBase, buttonStyles.ghost)}>
            Cancelar
          </button>
        ) : null}
        {inlineStatus ? (
          <span role="status" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
