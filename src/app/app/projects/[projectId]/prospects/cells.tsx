import { ExternalLink } from "lucide-react";
import {
  AlignLeft,
  Calendar,
  CircleChevronDown,
  Gauge,
  Hash,
  Link2,
  ListChecks,
  Mail,
  Smartphone,
  SquareCheck,
  Type,
  type LucideIcon,
} from "lucide-react";
import { formatCell, type BaseColumn, type ColumnType } from "@/lib/prospect-columns";
import { normalizeDomain } from "@/server/prospects/service";

export const COLUMN_ICONS: Record<ColumnType, LucideIcon> = {
  text: Type,
  long: AlignLeft,
  number: Hash,
  date: Calendar,
  bool: SquareCheck,
  select: CircleChevronDown,
  multi: ListChecks,
  url: Link2,
  email: Mail,
  phone: Smartphone,
  score: Gauge,
};

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
