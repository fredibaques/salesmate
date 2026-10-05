"use client";

import { useActionState, type ReactNode } from "react";
import { useModal } from "./modal";
import { useToast } from "./toast";
import { buttonClass, cx, type ButtonVariant } from "./ui";

export type FormState = { ok: boolean; message: string } | null;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Form bound to a server action that returns a status message. Success
 * shows as a toast (and closes the enclosing modal); errors appear next to
 * the button. Inside a modal it adds «Cancelar».
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
  submitVariant?: ButtonVariant;
  className?: string;
  confirm?: string;
}) {
  const modal = useModal();
  const toast = useToast();
  // Success is confirmed with a toast as soon as the server answers: the
  // refreshed page may remount this form (new version) or, in a modal, move
  // or remove the button that opened it, so an inline message or an effect
  // would be lost. Errors stay next to the button.
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    toast
      ? async (prev, formData) => {
          const result = await action(prev, formData);
          if (result?.ok) {
            toast({ ok: true, message: result.message });
            modal?.close();
          }
          return result;
        }
      : action,
    null,
  );

  const inlineStatus = state && !(toast && state.ok);

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
        <button type="submit" disabled={pending} className={buttonClass({ variant: submitVariant })}>
          {pending ? "Un momento…" : submitLabel}
        </button>
        {modal ? (
          <button type="button" onClick={modal.close} className={buttonClass({ variant: "ghost" })}>
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
