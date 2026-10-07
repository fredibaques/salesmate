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
import type { ColumnType } from "@/lib/prospect-columns";

/** The icon of each column type, in the table header and the editors. */
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
