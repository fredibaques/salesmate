"use client";

import { useRef, useState } from "react";
import { AddButton, RemoveButton, rowId } from "@/components/list-input";
import { controlClass } from "@/components/form-controls";
import { OPTION_COLOR_LOOK } from "@/components/option-chip";
import { cx } from "@/components/ui";
import { OPTION_COLORS, optionColor, type BaseColumn, type OptionColor } from "@/lib/prospect-columns";

/**
 * The choices of a select, multi or phase column, each with the colour of
 * its tag: the dot before it opens the palette. Every row submits `options`
 * and `optionColor`, in the same order (read them with `optionsFromForm`).
 */
export function OptionsInput({
  column,
  defaultValue,
  addLabel,
}: {
  column?: Pick<BaseColumn, "options" | "optionColors">;
  defaultValue: string[];
  addLabel: string;
}) {
  const auto = (i: number) => OPTION_COLORS[1 + (i % (OPTION_COLORS.length - 1))];
  const [rows, setRows] = useState(() =>
    (defaultValue.length ? defaultValue : [""]).map((value, i) => ({
      id: rowId(),
      value,
      color: value && column ? optionColor(column, value) : auto(i),
    })),
  );
  const [picking, setPicking] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  function add() {
    setRows((r) => [...r, { id: rowId(), value: "", color: auto(r.length) }]);
    requestAnimationFrame(() =>
      box.current?.querySelector<HTMLInputElement>("li:last-child input[type=text]")?.focus(),
    );
  }
  const setColor = (id: number, color: OptionColor) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, color } : x)));
    setPicking(null);
  };

  return (
    <div ref={box} className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPicking((p) => (p === row.id ? null : row.id))}
                aria-label={`Color: ${OPTION_COLOR_LOOK[row.color].label}`}
                aria-expanded={picking === row.id}
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-border transition-colors hover:border-border-strong"
              >
                <span className={cx("size-4 rounded-full", OPTION_COLOR_LOOK[row.color].dot)} />
              </button>
              <input type="hidden" name="optionColor" value={row.color} />
              <input
                type="text"
                name="options"
                defaultValue={row.value}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    add();
                  }
                }}
                className={controlClass()}
              />
              <RemoveButton
                label="Quitar"
                onClick={() =>
                  setRows((r) =>
                    r.length > 1
                      ? r.filter((x) => x.id !== row.id)
                      : [{ id: rowId(), value: "", color: auto(0) }],
                  )
                }
              />
            </div>
            {picking === row.id ? (
              <div
                role="radiogroup"
                aria-label="Color de la etiqueta"
                className="flex flex-wrap gap-1.5 pl-11"
              >
                {OPTION_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={row.color === c}
                    aria-label={OPTION_COLOR_LOOK[c].label}
                    title={OPTION_COLOR_LOOK[c].label}
                    onClick={() => setColor(row.id, c)}
                    className={cx(
                      "grid size-7 place-items-center rounded-full transition-transform hover:scale-110",
                      row.color === c && "ring-2 ring-accent ring-offset-1",
                    )}
                  >
                    <span className={cx("size-5 rounded-full", OPTION_COLOR_LOOK[c].dot)} />
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <AddButton onClick={add}>{addLabel}</AddButton>
    </div>
  );
}
