"use client";

import { ChevronRight, ChevronsUpDown, Check, LogOut, PanelLeft, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { Logo } from "./logo";

/**
 * The app's side navigation. Always one screen tall: only a section marked
 * `grow` scrolls inside it (the project list).
 */
export function Sidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar">
      {children}
    </aside>
  );
}

export function SidebarBrand({ href, title, subtitle }: { href: string; title: string; subtitle?: string }) {
  return (
    <Link
      href={href}
      className="mx-3 mt-3 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-ink-50"
    >
      <Logo size={32} />
      <span className="min-w-0">
        <span className="block truncate font-display text-[15px] font-semibold tracking-tight">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
    </Link>
  );
}

/** A group of entries, with an optional heading and an action next to it (e.g. «+»). */
export function SidebarSection({
  label,
  action,
  grow = false,
  children,
}: {
  label?: string;
  action?: ReactNode;
  /** Takes the remaining height and scrolls on its own. */
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("mt-4 flex flex-col", grow && "min-h-0 flex-1")}>
      {label ? (
        <div className="mb-1 flex h-7 items-center justify-between pr-3 pl-5">
          <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
          {action}
        </div>
      ) : null}
      <nav className={cx("space-y-0.5 px-3", grow && "min-h-0 flex-1 overflow-y-auto pb-2")}>{children}</nav>
    </div>
  );
}

/** Active when the path is `href` (or below it unless `exact`), or below any of `also`. */
export function useActive(href: string, exact: boolean, also: string[] = []) {
  const pathname = usePathname();
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  return (exact ? pathname === href : under(href)) || also.some(under);
}

/** A number on a sidebar entry or a tab (pending approvals…). */
export function CountBadge({ count, tone = "accent" }: { count: number; tone?: "accent" | "muted" }) {
  if (count <= 0) return null;
  return (
    <span
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums",
        tone === "accent" ? "bg-primary text-primary-foreground" : "bg-border text-muted",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function SidebarItem({
  href,
  icon,
  children,
  badge,
  exact = false,
  also,
}: {
  href: string;
  /** An icon, or a `SidebarDot`/avatar for entities like projects. */
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
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors [&>svg]:size-4 [&>svg]:shrink-0",
        active
          ? "bg-ink-100 font-medium text-foreground [&>svg]:text-accent"
          : "text-ink-700 hover:bg-ink-50 hover:text-foreground [&>svg]:text-muted hover:[&>svg]:text-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {badge}
    </Link>
  );
}

/**
 * An entry with entries of its own one level down (a project and its
 * agents). A chevron shows or hides them; it opens by itself on its pages.
 */
export function SidebarGroup({
  href,
  icon,
  label,
  badge,
  items,
}: {
  href: string;
  icon?: ReactNode;
  label: ReactNode;
  badge?: ReactNode;
  items: { href: string; icon?: ReactNode; label: ReactNode; badge?: ReactNode }[];
}) {
  const pathname = usePathname();
  const under = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  const inside = under(href);
  const childActive = items.some((i) => under(i.href));
  // Open while on its pages; the chevron overrides it until the next navigation into it.
  const [toggled, setToggled] = useState<{ at: boolean; open: boolean } | null>(null);
  const open = toggled && toggled.at === inside ? toggled.open : inside;
  const active = inside && !childActive;
  return (
    <div>
      <div
        className={cx(
          "group/row flex h-9 items-center rounded-lg text-sm transition-colors",
          active
            ? "bg-ink-100 font-medium text-foreground"
            : "text-ink-700 hover:bg-ink-50 hover:text-foreground",
        )}
      >
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2.5"
        >
          {icon}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {badge}
        </Link>
        {items.length ? (
          <button
            type="button"
            onClick={() => setToggled({ at: inside, open: !open })}
            aria-expanded={open}
            aria-label={open ? "Ocultar agentes" : "Mostrar agentes"}
            className="mr-1 ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-ink-100 hover:text-foreground"
          >
            <ChevronRight className={cx("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-2" />
        )}
      </div>
      {open && items.length ? (
        <div className="mt-0.5 mb-1 ml-[1.15rem] space-y-0.5 border-l border-border pl-2">
          {items.map((item) => {
            const current = under(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] transition-colors [&>svg]:size-3.5 [&>svg]:shrink-0",
                  current
                    ? "bg-ink-100 font-medium text-foreground [&>svg]:text-accent"
                    : "text-ink-700 hover:bg-ink-50 hover:text-foreground [&>svg]:text-muted",
                )}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.badge}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** Letter avatar for an entity in the sidebar (a project). */
export function SidebarDot({ label, muted = false }: { label: string; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold",
        muted ? "bg-border text-muted" : "bg-brand-100 text-accent",
      )}
    >
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The signed-in person at the bottom of the sidebar. Opens a menu with their
 * account, the organizations they can switch to and «Salir».
 */
export function UserMenu({
  name,
  email,
  organization,
  organizations,
  onSwitch,
  onSignOut,
}: {
  name: string;
  email: string;
  organization: { id: string; name: string };
  organizations: { id: string; name: string }[];
  onSwitch: (organizationId: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  // Remember where it was opened: navigating anywhere closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (value: boolean) => setOpenAt(value ? pathname : null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpenAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-ink-100 [&>svg]:size-4 [&>svg]:text-muted";

  return (
    <div ref={box} className="relative border-t border-border p-3">
      {open ? (
        <div
          role="menu"
          className="absolute right-3 bottom-full left-3 z-40 mb-1 rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <div className="px-2.5 py-1.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-muted">{email}</p>
          </div>
          <div className="my-1 border-t border-border" />
          <Link href="/app/account" role="menuitem" className={item}>
            <UserRound />
            Mi cuenta
          </Link>
          <Link href="/app/account/menu" role="menuitem" className={item}>
            <PanelLeft />
            Personalizar el menú
          </Link>
          {organizations.length > 1 ? (
            <>
              <div className="my-1 border-t border-border" />
              <p className="px-2.5 py-1 text-xs font-medium text-muted">Organización</p>
              {organizations.map((o) =>
                o.id === organization.id ? (
                  <div key={o.id} className={cx(item, "font-medium hover:bg-transparent")}>
                    <Check className="!text-accent" />
                    <span className="truncate">{o.name}</span>
                  </div>
                ) : (
                  <form key={o.id} action={onSwitch.bind(null, o.id)}>
                    <button role="menuitem" className={item}>
                      <span className="size-4" />
                      <span className="truncate">{o.name}</span>
                    </button>
                  </form>
                ),
              )}
            </>
          ) : null}
          <div className="my-1 border-t border-border" />
          <form action={onSignOut}>
            <button role="menuitem" className={item}>
              <LogOut />
              Salir
            </button>
          </form>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ink-50",
          open && "bg-ink-50",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
          {(name || email).slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name || email}</span>
          <span className="block truncate text-xs text-muted">{organization.name}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" />
      </button>
    </div>
  );
}
