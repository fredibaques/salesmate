import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type Crumb = { label: string; href?: string };

/**
 * The bar across the top of the content, on every page. It holds the trail
 * when there is one and stays empty otherwise, so the content always starts
 * at the same height. On phones the app header is already there: the bar
 * only shows when it has a trail.
 */
export function TopBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-14 z-30 hidden min-h-12 items-center border-b border-border bg-background/90 px-4 backdrop-blur has-[nav]:flex md:top-0 md:flex md:px-8">
      {children}
    </div>
  );
}

/**
 * Where you are, inside the `TopBar`. Only on pages one level below a section
 * (an agent, a document, a base): the section's own pages have its header.
 * The last crumb is the current page.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Ruta">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-400" /> : null}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="max-w-36 truncate rounded px-1 sm:max-w-56 py-0.5 transition-colors hover:bg-ink-100 hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className="max-w-48 truncate px-1 font-medium text-foreground sm:max-w-72"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
