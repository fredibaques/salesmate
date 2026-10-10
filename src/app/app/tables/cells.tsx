import { ExternalLink, Lock, Sparkles } from "lucide-react";
import { formatCell, type BaseColumn } from "@/lib/prospect-columns";
import type { CellMeta } from "@/server/db/schema";
import { normalizeDomain } from "@/server/prospects/service";

export { COLUMN_ICONS } from "./column-icons";

export function WebLink({ href }: { href: string }) {
  const url = href.startsWith("http") ? href : `https://${href}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-accent hover:underline"
    >
      {normalizeDomain(href) ?? href}
      <ExternalLink className="size-3" />
    </a>
  );
}

export function ScoreBar({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-ink-100">
        <span
          className="block h-full bg-brand-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      {value}
    </span>
  );
}

/** One value of a column, shown by its type. */
export function CellValue({ column, value }: { column: BaseColumn; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;
  switch (column.type) {
    case "url":
      return <WebLink href={String(value)} />;
    case "email":
      return <span className="select-all">{String(value)}</span>;
    case "score":
      return typeof value === "number" ? <ScoreBar value={value} /> : <>{String(value)}</>;
    case "bool":
      return value === true ? (
        <span className="font-medium text-success">Sí</span>
      ) : (
        <span className="text-muted">No</span>
      );
    case "select":
    case "stage":
      return (
        <span className="rounded-sm bg-ink-100 px-1.5 py-0.5 text-xs text-ink-700">{String(value)}</span>
      );
    case "multi":
      return (
        <span className="inline-flex gap-1">
          {(Array.isArray(value) ? value : [value]).map((v) => (
            <span key={String(v)} className="rounded-sm bg-ink-100 px-1.5 py-0.5 text-xs text-ink-700">
              {String(v)}
            </span>
          ))}
        </span>
      );
    case "long":
      return <span className="block max-w-72 truncate">{String(value)}</span>;
    default:
      return <>{formatCell(column, value)}</>;
  }
}

/**
 * A cell of the table with its state: its value (with a lock when a person
 * wrote it, so the agent leaves it alone), «no encontrado» when the agent
 * looked for it in vain, or «por completar» when the agent still has to fill it.
 */
export function CellState({
  column,
  value,
  meta,
  pending,
  filling = false,
  agent = true,
}: {
  column: BaseColumn;
  value: unknown;
  meta: CellMeta | undefined;
  pending: boolean;
  /** An agent is filling it right now. */
  filling?: boolean;
  /** An agent fills the table: hand-written values show a lock (it won't change them). */
  agent?: boolean;
}) {
  if (value !== null && value !== undefined && value !== "") {
    return agent && meta?.by === "user" ? (
      <span className="inline-flex items-center gap-1.5">
        <CellValue column={column} value={value} />
        <Lock className="size-3 shrink-0 text-ink-400" aria-label="Escrito a mano" />
      </span>
    ) : (
      <CellValue column={column} value={value} />
    );
  }
  if (meta?.notFound) return <NotFound />;
  if (pending && filling) return <Filling />;
  return pending ? <Pending /> : null;
}

/** A cell an agent is filling right now: the text shimmers until the value arrives. */
export function Filling() {
  return (
    <span className="inline-flex items-center gap-1 text-xs" role="status">
      <Sparkles className="size-3 animate-pulse text-brand-600" aria-hidden />
      <span className="text-shimmer font-medium">completándose</span>
    </span>
  );
}

export function Pending() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-400">
      <Sparkles className="size-3" aria-hidden />
      por completar
    </span>
  );
}

export function NotFound() {
  return <span className="text-xs text-ink-400 italic">no encontrado</span>;
}

/** The tooltip of a cell: where its value comes from. */
export function cellTitle(meta: CellMeta | undefined): string | undefined {
  if (meta?.by === "user") return "Escrito a mano: el agente no lo cambia";
  if (meta?.notFound) return "El agente lo buscó y no lo encontró publicado";
  if (meta?.source) return `Fuente: ${meta.source}`;
  return undefined;
}
