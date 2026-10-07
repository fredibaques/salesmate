"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useRef, useState, type ReactNode } from "react";
import type { FormAction, FormState } from "./action-form";
import { cx } from "./cx";
import { buttonClass } from "./ui";

export type WizardStep = {
  id: string;
  title: string;
  /** One short line under the step title, inside the step. */
  summary?: string;
  /** The step's fields. A function receives what the form holds so far (for a review step). */
  content: ReactNode | ((values: FormData) => ReactNode);
};

/**
 * A form split into steps: one server action receives everything at the end.
 * Each step is checked (required fields, formats) before moving on, and
 * already visited steps can be reopened from the step list.
 */
export function Wizard({
  steps,
  action,
  submitLabel,
  cancelHref,
  onStepChange,
}: {
  steps: WizardStep[];
  action: FormAction;
  submitLabel: string;
  cancelHref: string;
  /** Called when a step opens, e.g. to prepare its content from earlier answers. */
  onStepChange?: (index: number) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const [current, setCurrent] = useState(0);
  const [reached, setReached] = useState(0);
  const [values, setValues] = useState<FormData | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, null);
  const last = current === steps.length - 1;

  function go(index: number) {
    if (form.current) setValues(new FormData(form.current));
    setCurrent(index);
    setReached((r) => Math.max(r, index));
    onStepChange?.(index);
    form.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /** Shows the browser's message on the first invalid field of the current step. */
  function currentStepValid() {
    const fields =
      panels.current[current]?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [];
    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        return false;
      }
    }
    return true;
  }

  function next() {
    if (currentStepValid()) go(current + 1);
  }

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[14rem_1fr]">
      <ol className="space-y-1 lg:sticky lg:top-8">
        {steps.map((step, i) => {
          const done = i < current || (i <= reached && i !== current);
          const reachable = i <= reached && !pending;
          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => (i < current || currentStepValid()) && go(i)}
                aria-current={i === current ? "step" : undefined}
                className={cx(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                  i === current
                    ? "bg-brand-100 font-medium text-accent"
                    : reachable
                      ? "hover:bg-ink-100"
                      : "",
                  !reachable && "cursor-default text-muted",
                )}
              >
                <span
                  className={cx(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    i === current
                      ? "border-primary bg-primary text-primary-foreground"
                      : done
                        ? "border-success bg-success text-white"
                        : "border-border bg-surface text-muted",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </span>
                {step.title}
              </button>
            </li>
          );
        })}
      </ol>

      <form
        ref={form}
        // Submitted by hand rather than with `action`: React resets a form after
        // its action, so a rejected submit would wipe every step.
        onSubmit={(e) => {
          e.preventDefault();
          if (!currentStepValid()) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => formAction(data));
        }}
        onKeyDown={(e) => {
          // Enter in a single-line field moves forward instead of submitting early.
          if (e.key === "Enter" && !last && (e.target as HTMLElement).tagName === "INPUT") {
            e.preventDefault();
            next();
          }
        }}
        className="scroll-mt-8 rounded-xl border border-border bg-surface"
      >
        {steps.map((step, i) => (
          <div
            key={step.id}
            ref={(el) => {
              panels.current[i] = el;
            }}
            hidden={i !== current}
            className="p-6"
          >
            <p className="text-xs font-medium tracking-wide text-muted uppercase">
              Paso {i + 1} de {steps.length}
            </p>
            <h2 className="mt-1 text-lg font-semibold">{step.title}</h2>
            {step.summary ? <p className="mt-1 text-sm text-muted">{step.summary}</p> : null}
            <div className="mt-6 space-y-5">
              {typeof step.content === "function"
                ? i === current && values
                  ? step.content(values)
                  : null
                : step.content}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-4">
          {current === 0 ? (
            <Link href={cancelHref} className={buttonClass({ variant: "ghost" })}>
              Cancelar
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => go(current - 1)}
              className={buttonClass({ variant: "ghost" })}
            >
              <ArrowLeft />
              Atrás
            </button>
          )}
          {state && !state.ok ? (
            <span role="status" className="text-sm text-danger">
              {state.message}
            </span>
          ) : null}
          <span className="ml-auto" />
          {/* Different keys: reusing one <button> would turn the click on «Siguiente» into a submit. */}
          {last ? (
            <button
              key="submit"
              type="submit"
              disabled={pending}
              className={buttonClass({ variant: "primary" })}
            >
              {pending ? "Un momento…" : submitLabel}
            </button>
          ) : (
            <button key="next" type="button" onClick={next} className={buttonClass({ variant: "primary" })}>
              Siguiente
              <ArrowRight />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
