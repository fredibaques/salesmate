"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "./ui";

/** Active when the path is `href` (or below it unless `exact`), or below any of `also`. */
function useActive(href: string, exact: boolean, also: string[] = []) {
  const pathname = usePathname();
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return (exact ? pathname === href : under(href)) || also.some(under);
}

/** Sidebar entry. */
export function NavLink({
  href,
  icon,
  children,
  badge,
  exact = false,
  also,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  exact?: boolean;
  /** Other sections that belong to this entry (e.g. «Configuración» covers several pages). */
  also?: string[];
}) {
  const active = useActive(href, exact, also);
  return (
    <Link
      href={href}
      className={cx(
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors [&>svg]:size-4 [&>svg]:shrink-0",
        active ? "bg-accent/10 font-medium text-accent" : "text-foreground hover:bg-background [&>svg]:text-muted",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </Link>
  );
}

/** Main tabs of a page (project, agent, settings). They wrap instead of scrolling. */
export function Tabs({ children, className }: { children: ReactNode; className?: string }) {
  return <nav className={cx("mb-6 flex flex-wrap gap-x-1 border-b border-border", className)}>{children}</nav>;
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

/** Second-level navigation inside a tab (e.g. Conocimiento → Oferta y cliente · Documentos). */
export function SubTabs({ children }: { children: ReactNode }) {
  return <nav className="mb-6 inline-flex flex-wrap gap-1 rounded-xl bg-border/50 p-1">{children}</nav>;
}

export function SubTabLink({ href, children, exact = true }: { href: string; children: ReactNode; exact?: boolean }) {
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
