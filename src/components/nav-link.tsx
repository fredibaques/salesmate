"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { useActive } from "./sidebar";

/** Main tabs of a page (project, agent, settings). They wrap instead of scrolling. */
export function Tabs({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <nav
      className={cx(
        "mb-6 flex gap-x-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&>*]:shrink-0",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function TabLink({
  href,
  children,
  exact = false,
  also,
  badge,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
  also?: string[];
  badge?: ReactNode;
}) {
  const active = useActive(href, exact, also);
  return (
    <Link
      href={href}
      className={cx(
        "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-accent font-medium text-accent"
          : "border-transparent text-muted hover:border-border hover:text-foreground",
      )}
    >
      {children}
      {badge}
    </Link>
  );
}

/** Second-level navigation inside a tab (e.g. Ajustes → General · Reglas y exclusiones). */
export function SubTabs({ children }: { children: ReactNode }) {
  return <nav className="mb-6 inline-flex flex-wrap gap-1 rounded-xl bg-ink-100 p-1">{children}</nav>;
}

export function SubTabLink({
  href,
  children,
  exact = true,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
}) {
  const active = useActive(href, exact);
  return (
    <Link
      href={href}
      className={cx(
        "rounded-lg px-3 py-1.5 text-sm transition-colors",
        active ? "bg-surface font-medium text-foreground shadow-sm" : "text-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
