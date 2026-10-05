import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { InfoTip } from "./tooltip";

// ---------------------------------------------------------------------------
// Form controls: one recipe for every field (see docs/DESIGN.md, «Inputs»)
// ---------------------------------------------------------------------------

const controlSizes = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3 text-sm",
  lg: "h-11 px-3.5 text-base",
};

export type ControlSize = keyof typeof controlSizes;
export type ControlLook = { size?: ControlSize; invalid?: boolean };

/** Classes for a text-like control (input, select, textarea). */
export function controlClass({
  size = "md",
  invalid = false,
  multiline = false,
}: ControlLook & { multiline?: boolean } = {}) {
  return cx(
    "w-full rounded-lg border bg-surface text-foreground shadow-xs transition-colors outline-none placeholder:text-muted/70",
    "hover:border-muted/50 focus:ring-2",
    "disabled:cursor-not-allowed disabled:bg-background disabled:text-muted disabled:hover:border-border",
    invalid
      ? "border-danger focus:border-danger focus:ring-danger/20"
      : "border-border focus:border-accent focus:ring-accent/20 aria-invalid:border-danger",
    multiline
      ? cx(
          "min-h-24 py-2 leading-relaxed",
          size === "lg" ? "px-3.5 text-base" : size === "sm" ? "px-2.5 text-xs" : "px-3 text-sm",
        )
      : controlSizes[size],
  );
}

/**
 * Label, control and help for one value. `tip` explains how it works on
 * hover; `hint` is a short line under the control for what isn't obvious;
 * `error` replaces the hint. Use `group` when the control is a set of
 * checkboxes, radios or chips.
 */
export function Field({
  label,
  hint,
  tip,
  error,
  optional,
  group,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  tip?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  group?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const heading = (
    <span className="flex items-center gap-1 text-sm font-medium">
      {label}
      {optional ? <span className="font-normal text-muted">(opcional)</span> : null}
      {tip ? <InfoTip>{tip}</InfoTip> : null}
    </span>
  );
  const help = error ? (
    <span className="mt-1.5 block text-xs text-danger">{error}</span>
  ) : hint ? (
    <span className="mt-1.5 block text-xs text-muted">{hint}</span>
  ) : null;
  if (group) {
    return (
      <fieldset className={cx("block min-w-0", className)}>
        <legend className="mb-1.5">{heading}</legend>
        {children}
        {help}
      </fieldset>
    );
  }
  return (
    <label className={cx("block min-w-0", className)}>
      <span className="mb-1.5 block">{heading}</span>
      {children}
      {help}
    </label>
  );
}

type InputProps = Omit<ComponentProps<"input">, "size"> &
  ControlLook & {
    /** Icon inside the field, on the left (e.g. a magnifier in a search box). */
    icon?: ReactNode;
    /** Unit or text inside the field, on the right («min», «€», «%»). */
    suffix?: ReactNode;
  };

export function Input({ size, invalid, icon, suffix, className, ...props }: InputProps) {
  const input = (
    <input
      {...props}
      className={cx(
        controlClass({ size, invalid }),
        icon ? "pl-9" : null,
        suffix ? "pr-12" : null,
        !icon && !suffix ? className : null,
      )}
    />
  );
  if (!icon && !suffix) return input;
  return (
    <div className={cx("relative h-fit", className)}>
      {icon ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted [&_svg]:size-4">
          {icon}
        </span>
      ) : null}
      {input}
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Textarea({
  size,
  invalid,
  className,
  ...props
}: Omit<ComponentProps<"textarea">, "size"> & ControlLook) {
  return <textarea {...props} className={cx(controlClass({ size, invalid, multiline: true }), className)} />;
}

export function Select({
  size,
  invalid,
  className,
  ...props
}: Omit<ComponentProps<"select">, "size"> & ControlLook) {
  return (
    <div className={cx("relative h-fit", className)}>
      <select {...props} className={cx(controlClass({ size, invalid }), "appearance-none pr-9")} />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

/**
 * A checkbox or radio with its label and an optional description. `card`
 * makes it a bordered option that highlights when chosen (for choices that
 * need explaining, e.g. how a conversation should end).
 */
export function Choice({
  type = "checkbox",
  label,
  description,
  card = false,
  className,
  ...input
}: Omit<ComponentProps<"input">, "type"> & {
  type?: "checkbox" | "radio";
  label: ReactNode;
  description?: ReactNode;
  card?: boolean;
}) {
  return (
    <label
      className={cx(
        "flex items-start gap-3 text-sm",
        card &&
          "rounded-xl border border-border bg-surface p-4 transition-colors hover:border-muted/50 hover:bg-background has-[:checked]:border-accent has-[:checked]:bg-accent/5",
        input.disabled && "opacity-60",
        className,
      )}
    >
      <input type={type} {...input} className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">
        <span className={cx("block", card && "font-medium")}>{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/** A small toggle pill (checkbox or radio), e.g. the days of the week. */
export function Chip({
  type = "checkbox",
  children,
  ...input
}: Omit<ComponentProps<"input">, "type"> & { type?: "checkbox" | "radio"; children: ReactNode }) {
  return (
    <label className="inline-flex">
      <input type={type} {...input} className="peer sr-only" />
      <span
        className={cx(
          "inline-flex h-8 min-w-8 items-center justify-center rounded-lg border border-border bg-surface px-2.5 text-sm transition-colors select-none",
          "hover:border-muted/50 peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-foreground",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40 peer-disabled:opacity-50",
        )}
      >
        {children}
      </span>
    </label>
  );
}

/** Two to four exclusive options shown side by side (B2B · B2C). */
export function Segmented({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: { value: string; label: ReactNode }[];
  defaultValue?: string;
}) {
  return (
    <div role="radiogroup" className="inline-flex flex-wrap gap-1 rounded-xl bg-border/50 p-1">
      {options.map((o) => (
        <label key={o.value} className="inline-flex">
          <input
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={o.value === defaultValue}
            className="peer sr-only"
          />
          <span className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors select-none hover:text-foreground peer-checked:bg-surface peer-checked:font-medium peer-checked:text-foreground peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

/** A titled block inside a long form, separated from the previous one by a line. */
export function FormSection({
  title,
  tip,
  children,
}: {
  title: string;
  tip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-1 text-sm font-semibold">
        {title}
        {tip ? <InfoTip>{tip}</InfoTip> : null}
      </h3>
      {children}
    </section>
  );
}
