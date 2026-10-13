import { optionColor, type BaseColumn, type OptionColor } from "@/lib/prospect-columns";
import { cx } from "./cx";

/** How each colour of a choice looks: a tag, and the dot that picks it. */
export const OPTION_COLOR_LOOK: Record<OptionColor, { label: string; tag: string; dot: string }> = {
  gris: { label: "Gris", tag: "bg-ink-100 text-ink-700", dot: "bg-ink-400" },
  rojo: { label: "Rojo", tag: "bg-red-100 text-red-800", dot: "bg-red-500" },
  naranja: { label: "Naranja", tag: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  amarillo: { label: "Amarillo", tag: "bg-amber-100 text-amber-800", dot: "bg-amber-400" },
  verde: { label: "Verde", tag: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  turquesa: { label: "Turquesa", tag: "bg-teal-100 text-teal-800", dot: "bg-teal-500" },
  azul: { label: "Azul", tag: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
  morado: { label: "Morado", tag: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  rosa: { label: "Rosa", tag: "bg-pink-100 text-pink-800", dot: "bg-pink-500" },
};

/** One choice of a select, multi or phase column, as a tag in its colour. */
export function OptionChip({
  column,
  value,
  className,
}: {
  column: Pick<BaseColumn, "options" | "optionColors">;
  value: string;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-block max-w-full truncate rounded-sm px-1.5 py-0.5 text-xs font-medium",
        OPTION_COLOR_LOOK[optionColor(column, value)].tag,
        className,
      )}
    >
      {value}
    </span>
  );
}
