import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cx } from "./cx";
import { InfoTip } from "./tooltip";

export { cx } from "./cx";
export * from "./form-controls";
export * from "./tooltip";

/**
 * Top of a page (or of a nested page such as an agent inside a project):
 * title with its status and the page's actions on the
 * right. No paragraph under the title: when the page needs explaining, `tip`
 * puts a «?» next to it. Use `level="section"` below another header.
 */
export function PageHeader({
  title,
  tip,
  actions,
  badge,
  icon,
  media,
  level = "page",
  className,
}: {
  title: ReactNode;
  tip?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  /** Replaces the icon tile, e.g. a tool's logo avatar. */
  media?: ReactNode;
  level?: "page" | "section";
  className?: string;
}) {
  const Heading = level === "page" ? "h1" : "h2";
  return (
    <header className={cx(level === "page" ? "mb-6" : "mb-5", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* As tall as the title's line, never taller. */}
          {media ?? (icon ? <IconTile size={level === "page" ? "title" : "sm"}>{icon}</IconTile> : null)}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Heading
                className={cx(
                  "min-w-0 truncate font-semibold tracking-tight",
                  level === "page" ? "text-2xl" : "text-xl",
                )}
              >
                {title}
              </Heading>
              {tip ? <InfoTip>{tip}</InfoTip> : null}
              {badge}
            </div>
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-nowrap">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

const tileSizes = {
  /** Next to a section title (text-xl, 28px line). */
  sm: "size-7 rounded-md [&_svg]:size-4",
  /** Next to a page title (text-2xl, 32px line). */
  title: "size-8 rounded-md [&_svg]:size-[18px]",
  md: "size-9 rounded-lg [&_svg]:size-[18px]",
  lg: "size-11 rounded-lg [&_svg]:size-5",
};

const tileTones = {
  accent: "bg-brand-100 text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  neutral: "bg-background text-muted",
};

/** Square icon holder that identifies an entity (agent, source, project…). */
export function IconTile({
  children,
  tone = "accent",
  size = "md",
  colors,
}: {
  children: ReactNode;
  tone?: keyof typeof tileTones;
  size?: keyof typeof tileSizes;
  /** Background and text classes chosen by the user (an agent's colour), instead of `tone`. */
  colors?: string;
}) {
  return (
    <span
      aria-hidden
      className={cx("flex shrink-0 items-center justify-center", tileSizes[size], colors ?? tileTones[tone])}
    >
      {children}
    </span>
  );
}

/** Responsive grid for entity cards. */
export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("grid gap-4 sm:grid-cols-2 xl:grid-cols-3", className)}>{children}</div>;
}

/**
 * An entity shown as a card: projects, agents, connections, knowledge
 * sources. With `href` the whole card opens the entity; controls in the
 * footer (switches, buttons) stay independently clickable.
 * `placeholder` is for something not created yet (dashed, with an action
 * to create it); `disabled` for what is not available.
 */
export function EntityCard({
  href,
  icon,
  iconTone,
  media,
  title,
  badge,
  meta,
  description,
  children,
  footer,
  variant = "default",
}: {
  href?: string;
  icon?: ReactNode;
  iconTone?: keyof typeof tileTones;
  /** Replaces the icon tile, e.g. a tool's logo avatar. */
  media?: ReactNode;
  title: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  variant?: "default" | "placeholder" | "disabled";
}) {
  return (
    <article
      className={cx(
        "group relative flex flex-col rounded-xl border bg-surface p-5 shadow-xs transition",
        variant === "default" && "border-border",
        variant === "placeholder" && "border-dashed border-border",
        variant === "disabled" && "border-dashed border-border bg-transparent opacity-70",
        href && "hover:border-border-strong",
      )}
    >
      <div className="flex items-start gap-3">
        {media ??
          (icon ? (
            <IconTile tone={iconTone ?? (variant === "default" ? "accent" : "neutral")}>{icon}</IconTile>
          ) : null)}
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-snug">
            {href ? (
              <Link
                href={href}
                className="outline-none transition-colors group-hover:text-accent after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-accent/40"
              >
                {title}
              </Link>
            ) : (
              title
            )}
          </h3>
          {meta ? <p className="mt-0.5 text-xs text-muted">{meta}</p> : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
      {description ? <p className="mt-3 text-sm text-muted">{description}</p> : null}
      {children ? <div className="mt-3 text-sm">{children}</div> : null}
      {footer ? (
        <div className="relative z-10 mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
          {footer}
        </div>
      ) : null}
    </article>
  );
}

/** Joins short facts with a middle dot: «Tabla · 45 filas · hace 2 días». */
export function Meta({ items }: { items: (ReactNode | null | undefined | false)[] }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== "");
  return (
    <>
      {shown.map((item, i) => (
        <span key={i}>
          {i > 0 ? " · " : null}
          {item}
        </span>
      ))}
    </>
  );
}

export function Card({
  title,
  tip,
  actions,
  children,
  className,
}: {
  title?: string;
  /** How this section works, behind a «?» next to the title. */
  tip?: ReactNode;
  /** Buttons shown at the top right of the card (e.g. «Añadir…»). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = title || actions;
  return (
    <section className={cx("rounded-xl border border-border bg-surface p-5 shadow-xs", className)}>
      {hasHeader ? (
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-3">
          {title ? (
            <h2 className="flex min-w-0 items-center gap-1 text-base font-semibold">
              {title}
              {tip ? <InfoTip>{tip}</InfoTip> : null}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={hasHeader ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Buttons: one recipe for every clickable action (see docs/DESIGN.md)
// ---------------------------------------------------------------------------

const buttonVariants = {
  /** The main action of a view. One per view. */
  primary: "bg-primary text-primary-foreground shadow-brand hover:bg-primary-hover active:bg-brand-300",
  /** Other actions. */
  secondary:
    "border border-border bg-surface text-foreground shadow-xs hover:border-border-strong hover:bg-ink-50 active:bg-ink-100",
  /** Low-emphasis actions: in toolbars, headers, rows and next to a primary. */
  ghost: "text-foreground hover:bg-ink-100 active:bg-ink-200",
  /** Destructive action that needs weight (confirming a removal). */
  danger: "bg-danger text-white shadow-xs hover:bg-coral-700 active:bg-coral-700",
  /** Destructive action at rest («Quitar», trash icon in a row). */
  dangerGhost: "text-danger hover:bg-coral-50 active:bg-coral-100",
};

const buttonSizes = {
  sm: "h-8 gap-1 px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-9 gap-1.5 px-3.5 text-sm [&_svg]:size-4",
  lg: "h-11 gap-2 px-5 text-base [&_svg]:size-5",
};

/** Square buttons that only hold an icon (always with an aria-label). */
const iconOnlySizes = { sm: "size-8 px-0", md: "size-9 px-0", lg: "size-11 px-0" };

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonSize = keyof typeof buttonSizes;
export type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; block?: boolean };

/** Classes for anything that looks like a button: <button>, <Link>, <a>, <summary>… */
export function buttonClass({
  variant = "primary",
  size = "md",
  iconOnly = false,
  block = false,
}: ButtonLook = {}) {
  return cx(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
    buttonVariants[variant],
    buttonSizes[size],
    iconOnly && iconOnlySizes[size],
    block && "w-full",
  );
}

export function Button({
  variant,
  size,
  iconOnly,
  block,
  className,
  ...props
}: ComponentProps<"button"> & ButtonLook) {
  return <button className={cx(buttonClass({ variant, size, iconOnly, block }), className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size,
  iconOnly,
  block,
  className,
  href,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { href: string } & ButtonLook) {
  return (
    <Link href={href} className={cx(buttonClass({ variant, size, iconOnly, block }), className)} {...props} />
  );
}

/** Minimal badges: a coloured dot and the word, no box. */
const badgeStyles = {
  neutral: { text: "text-ink-600", dot: "bg-ink-400" },
  success: { text: "text-leaf-700", dot: "bg-leaf-500" },
  warning: { text: "text-amber-700", dot: "bg-amber-500" },
  danger: { text: "text-coral-700", dot: "bg-coral-500" },
  accent: { text: "text-brand-800", dot: "bg-brand-500" },
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeStyles;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        badgeStyles[tone].text,
      )}
    >
      <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", badgeStyles[tone].dot)} />
      {children}
    </span>
  );
}

/**
 * What a section shows when it has nothing yet: what goes here, why it matters
 * and the action that fills it.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center rounded-xl border border-dashed border-border text-center",
        compact ? "px-4 py-6" : "px-6 py-10",
      )}
    >
      {icon ? (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-brand-100 text-accent [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** A list row that navigates somewhere: the whole row is the click target. */
export function RowLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "-mx-2 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-3 transition-colors hover:bg-background",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Small letter avatar used for tools and accounts. */
export function Avatar({ label, color, className }: { label: string; color?: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={color ? { backgroundColor: color, color: "#fff" } : undefined}
      className={cx(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-sm font-semibold text-accent",
        className,
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-2 py-2 align-top", className)}>{children}</td>;
}

const noticeTones = {
  success: { box: "border-leaf-100 bg-leaf-50 text-foreground", icon: "text-leaf-700", Icon: CircleCheck },
  info: { box: "border-border bg-ink-50 text-foreground", icon: "text-accent", Icon: Info },
  warning: {
    box: "border-amber-100 bg-amber-50 text-foreground",
    icon: "text-amber-700",
    Icon: TriangleAlert,
  },
  danger: { box: "border-coral-100 bg-coral-50 text-foreground", icon: "text-coral-700", Icon: CircleAlert },
};

/** A message about the state of the page (something off, missing or worth knowing), with an optional fix. */
export function Notice({
  tone = "info",
  children,
  action,
}: {
  tone?: keyof typeof noticeTones;
  children: ReactNode;
  action?: ReactNode;
}) {
  const t = noticeTones[tone];
  return (
    <div className={cx("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border p-3 text-sm", t.box)}>
      <t.Icon className={cx("mt-0.5 size-4 shrink-0", t.icon)} />
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * The actions of a page whose title is already its tab (Conexiones,
 * Conversaciones…): right-aligned, with no second heading.
 */
export function Toolbar({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="mb-5 flex flex-wrap items-center justify-end gap-2">{children}</div>;
}
