"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({
  href,
  icon,
  children,
  badge,
  exact = false,
}: {
  href: string;
  icon?: ReactNode;
  children: ReactNode;
  badge?: ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors [&>svg]:size-4 [&>svg]:shrink-0 ${
        active
          ? "bg-accent/10 font-medium text-accent"
          : "text-foreground hover:bg-background [&>svg]:text-muted"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </Link>
  );
}

export function TabLink({
  href,
  children,
  exact = false,
}: {
  href: string;
  children: ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-accent font-medium text-accent"
          : "border-transparent text-muted hover:border-border hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
