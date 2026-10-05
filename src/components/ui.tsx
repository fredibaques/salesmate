import { ArrowLeft, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Top of a page (or of a nested page such as an agent inside a project):
 * optional back link, title with its status, one line of context and the
 * page's actions on the right. Use `level="section"` below another header.
 */
export function PageHeader({
  title,
  description,
  actions,
  badge,
  back,
  icon,
  media,
  level = "page",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  back?: { href: string; label: string };
  icon?: ReactNode;
  /** Replaces the icon tile, e.g. a tool's logo avatar. */
  media?: ReactNode;
  level?: "page" | "section";
  className?: string;
}) {
  const Heading = level === "page" ? "h1" : "h2";
  return (
    <header className={cx(level === "page" ? "mb-6" : "mb-5", className)}>
      {back ? <BackLink href={back.href}>{back.label}</BackLink> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          {media ?? (icon ? <IconTile size="lg">{icon}</IconTile> : null)}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Heading
                className={cx("font-semibold tracking-tight", level === "page" ? "text-2xl" : "text-xl")}
              >
                {title}
              </Heading>
              {badge}
            </div>
            {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex items-center gap-1 rounded-md text-sm text-muted transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {children}
    </Link>
  );
}

const tileTones = {
  accent: "bg-accent/10 text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  neutral: "bg-background text-muted",
};

/** Square icon holder that identifies an entity (agent, source, project…). */
export function IconTile({
  children,
  tone = "accent",
  size = "md",
}: {
  children: ReactNode;
  tone?: keyof typeof tileTones;
  size?: "md" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center rounded-lg",
        size === "lg" ? "size-11 [&_svg]:size-5" : "size-9 [&_svg]:size-[18px]",
        tileTones[tone],
      )}
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
        "group relative flex flex-col rounded-xl border bg-surface p-5 transition",
        variant === "default" && "border-border",
        variant === "placeholder" && "border-dashed border-border",
        variant === "disabled" && "border-dashed border-border bg-transparent opacity-70",
        href && "hover:border-accent/40 hover:shadow-sm",
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
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: ReactNode;
  /** Buttons shown at the top right of the card (e.g. «Añadir…»). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeader = title || description || actions;
  return (
    <section className={cx("rounded-xl border border-border bg-surface p-5", className)}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold">{title}</h2> : null}
            {description ? <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={hasHeader ? "mt-4" : undefined}>{children}</div>
    </section>
  );
}

export const buttonStyles = {
  primary: "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90 active:bg-accent/80",
  secondary: "border border-border bg-surface hover:border-muted/40 hover:bg-background active:bg-border/60",
  danger: "bg-danger text-white shadow-sm hover:bg-danger/90 active:bg-danger/80",
  ghost: "hover:bg-background active:bg-border/60",
  dangerGhost: "text-danger hover:bg-danger/10 active:bg-danger/15",
};

export type ButtonVariant = keyof typeof buttonStyles;

export const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50";

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={cx(buttonBase, buttonStyles[variant], className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  className,
  href,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { href: string; variant?: ButtonVariant }) {
  return <Link href={href} className={cx(buttonBase, buttonStyles[variant], className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const control =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(control, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cx(control, "min-h-24", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(control, props.className)} />;
}

const badgeStyles = {
  neutral: "bg-background text-muted border-border",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  accent: "bg-accent/10 text-accent border-accent/30",
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
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        badgeStyles[tone],
      )}
    >
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
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-accent/10 text-accent [&_svg]:size-5">
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
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-sm font-semibold text-accent",
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
  success: {
    box: "border-success/30 bg-success/10 text-foreground",
    icon: "text-success",
    Icon: CircleCheck,
  },
  info: { box: "border-border bg-surface text-foreground", icon: "text-accent", Icon: Info },
  warning: {
    box: "border-warning/40 bg-warning/10 text-foreground",
    icon: "text-warning",
    Icon: TriangleAlert,
  },
  danger: { box: "border-danger/40 bg-danger/10 text-foreground", icon: "text-danger", Icon: CircleAlert },
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
