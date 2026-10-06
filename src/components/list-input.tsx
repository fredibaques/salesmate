"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { controlClass } from "./form-controls";
import { cx } from "./cx";
import { buttonClass } from "./ui";

let nextId = 0;
const rowId = () => ++nextId;

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cx(buttonClass({ variant: "ghost", iconOnly: true }), "text-muted hover:text-danger")}
    >
      <X />
    </button>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={buttonClass({ variant: "ghost", size: "sm" })}>
      <Plus />
      {children}
    </button>
  );
}

/**
 * A list of short texts, one per row, that grows and shrinks. Every row is
 * submitted under `name` (read it with `list(form, name)`).
 */
export function ListInput({
  name,
  defaultValue = [],
  placeholder,
  addLabel = "Añadir",
}: {
  name: string;
  defaultValue?: string[];
  placeholder?: string;
  addLabel?: string;
}) {
  const [rows, setRows] = useState(() =>
    (defaultValue.length ? defaultValue : [""]).map((value) => ({ id: rowId(), value })),
  );
  const box = useRef<HTMLDivElement>(null);

  function add() {
    setRows((r) => [...r, { id: rowId(), value: "" }]);
    // Focus the new row once it exists.
    requestAnimationFrame(() => box.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus());
  }

  return (
    <div ref={box} className="space-y-2">
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <input
              name={name}
              defaultValue={row.value}
              placeholder={placeholder}
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
                  r.length > 1 ? r.filter((x) => x.id !== row.id) : [{ id: rowId(), value: "" }],
                )
              }
            />
          </li>
        ))}
      </ul>
      <AddButton onClick={add}>{addLabel}</AddButton>
    </div>
  );
}

/**
 * Pairs of texts (e.g. an objection and how to answer it). Each row submits
 * `names[0]` and `names[1]`, in the same order, empty values included.
 */
export function PairListInput({
  names,
  labels,
  defaultValue = [],
  placeholders = ["", ""],
  addLabel = "Añadir",
}: {
  names: [string, string];
  labels: [string, string];
  defaultValue?: [string, string][];
  placeholders?: [string, string];
  addLabel?: string;
}) {
  const [rows, setRows] = useState(() =>
    (defaultValue.length ? defaultValue : [["", ""] as [string, string]]).map((value) => ({
      id: rowId(),
      value,
    })),
  );
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-1 space-y-2 rounded-xl border border-border bg-background/60 p-3">
              <input
                name={names[0]}
                aria-label={labels[0]}
                defaultValue={row.value[0]}
                placeholder={placeholders[0]}
                className={controlClass()}
              />
              <textarea
                name={names[1]}
                aria-label={labels[1]}
                defaultValue={row.value[1]}
                placeholder={placeholders[1]}
                rows={2}
                className={cx(controlClass({ multiline: true }), "min-h-16")}
              />
            </div>
            <RemoveButton
              label="Quitar"
              onClick={() =>
                setRows((r) =>
                  r.length > 1 ? r.filter((x) => x.id !== row.id) : [{ id: rowId(), value: ["", ""] }],
                )
              }
            />
          </li>
        ))}
      </ul>
      <AddButton onClick={() => setRows((r) => [...r, { id: rowId(), value: ["", ""] }])}>
        {addLabel}
      </AddButton>
    </div>
  );
}
