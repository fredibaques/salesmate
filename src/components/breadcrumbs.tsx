import { ChevronRight } from "lucide-react";
import Link from "next/link";

export type Crumb = { label: string; href?: string };

/** Where you are, top left of every sub-page. The last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length < 2) return null;
  return (
    <nav aria-label="Ruta" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-400" /> : null}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="max-w-56 truncate rounded px-1 py-0.5 transition-colors hover:bg-ink-100 hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className="max-w-72 truncate px-1 font-medium text-foreground"
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
