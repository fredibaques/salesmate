import { cx } from "./cx";

/**
 * Placeholders shown while a page loads (`loading.tsx`): grey shapes in the
 * place and size of what is coming, with a soft shimmer.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton rounded-md", className)} />;
}

/** Lines of text; the last one shorter, like a paragraph. */
export function SkeletonText({ lines = 2, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

/** An entity card being loaded. */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-xs">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <SkeletonText lines={2} className="mt-5" />
    </div>
  );
}

function Status() {
  return <span className="sr-only">Cargando…</span>;
}

/** A page with a title and a grid of cards (dashboards, lists of entities). */
export function GridPageSkeleton({ header = true, cards = 6 }: { header?: boolean; cards?: number }) {
  return (
    <div role="status" aria-busy className="space-y-6">
      <Status />
      {header ? <Skeleton className="h-7 w-56" /> : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

/** A form in a card (settings, an agent's configuration). */
export function FormPageSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div
      role="status"
      aria-busy
      className="max-w-3xl rounded-xl border border-border bg-surface p-5 shadow-xs"
    >
      <Status />
      <Skeleton className="h-4 w-40" />
      <div className="mt-6 space-y-6">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className={cx("w-full rounded-lg", i % 3 === 1 ? "h-20" : "h-9")} />
          </div>
        ))}
      </div>
      <Skeleton className="mt-6 h-9 w-24 rounded-lg" />
    </div>
  );
}

/** A list of rows (conversations, approvals, audit). */
export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-busy className="rounded-xl border border-border bg-surface p-5 shadow-xs">
      <Status />
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The chat panel while Copilot loads. */
export function ChatSkeleton() {
  return (
    <div
      role="status"
      aria-busy
      className="flex h-[calc(100vh-7.5rem)] min-h-96 flex-col rounded-xl border border-border bg-surface shadow-xs"
    >
      <Status />
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-7 w-64 rounded-lg" />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Skeleton className="size-12 rounded-2xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-72" />
      </div>
      <div className="border-t border-border p-3">
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}
