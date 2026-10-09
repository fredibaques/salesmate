"use client";

import { unstable_rethrow } from "next/navigation";
import { startTransition, useActionState, useRef, type ReactNode } from "react";
import { useModal } from "./modal";
import { useToast } from "./toast";
import { buttonClass, cx, type ButtonVariant } from "./ui";

export type FormState = { ok: boolean; message: string } | null;
export type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Calls a server action and turns a failure to reach it (no connection, a
 * request the host refuses, like a file over its size limit) into an error
 * next to the button instead of breaking the page. Redirects and other
 * Next.js signals still go through.
 */
export async function callAction(
  action: FormAction,
  state: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    return await action(state, formData);
  } catch (err) {
    unstable_rethrow(err);
    return {
      ok: false,
      message:
        "No se ha podido enviar. Revisa tu conexión y que los ficheros no pasen de 4 MB, y vuelve a probar.",
    };
  }
}

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
  cancel = true,
  stayOpen = false,
}: {
  action: FormAction;
  children?: ReactNode;
  submitLabel: string;
  submitVariant?: ButtonVariant;
  /** Inside a modal, whether to add «Cancelar» (off for a secondary form next to the main one). */
  cancel?: boolean;
  className?: string;
  confirm?: string;
  /** Inside a modal, keep it open after saving (a form among others in it). */
  stayOpen?: boolean;
}) {
  const modal = useModal();
  const toast = useToast();
  // Success is confirmed with a toast as soon as the server answers: the
  // refreshed page may remount this form (new version) or, in a modal, move
  // or remove the button that opened it, so an inline message or an effect
  // would be lost. Errors stay next to the button.
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await callAction(action, prev, formData);
    if (result?.ok) {
      // Clean for the next use, as React does after an action; a rejected
      // submit keeps what was typed so it can be fixed and sent again.
      form.current?.reset();
      if (toast) {
        toast({ ok: true, message: result.message });
        if (!stayOpen) modal?.close();
      }
    }
    return result;
  }, null);

  const inlineStatus = state && !(toast && state.ok);

  return (
    <form
      ref={form}
      className={className ?? "space-y-3"}
      // Submitted by hand rather than with `action`, which would reset the
      // form even when the server rejects it.
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      <div
        className={cx(
          "flex flex-wrap items-center gap-3",
          modal && cancel && "flex-row-reverse justify-start pt-2",
        )}
      >
        <button type="submit" disabled={pending} className={buttonClass({ variant: submitVariant })}>
          {pending ? "Un momento…" : submitLabel}
        </button>
        {modal && cancel ? (
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
