"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { cx } from "@/components/ui";
import type { SaveCell } from "./grid-editing";

export type BoardCard = {
  id: string;
  seq: number;
  name: string;
  /** The row's phase; null (or one no longer among the phases) goes to «Sin fase». */
  stage: string | null;
  fitScore: number | null;
  /** A couple of the row's values, already as text. */
  details: string[];
  discarded: boolean;
  href: string;
};

const NONE = "";

/**
 * The table as a board: one list per phase of its pipeline column, in order,
 * and the rows as cards. Dragging a card to another list changes its phase
 * (the same as editing the cell); opening a card opens the row.
 */
export function KanbanBoard({
  stages,
  cards,
  field,
  save,
}: {
  stages: string[];
  cards: BoardCard[];
  /** The pipeline column's id. */
  field: string;
  save: SaveCell;
}) {
  const toast = useToast();
  const [, start] = useTransition();
  // Moves not yet confirmed by the server, by row.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const stageOf = (card: BoardCard) => {
    const stage = moved[card.id] ?? card.stage ?? NONE;
    return stages.includes(stage) ? stage : NONE;
  };
  const lists = [{ key: NONE, label: "Sin fase" }, ...stages.map((s) => ({ key: s, label: s }))].filter(
    (l) => l.key !== NONE || cards.some((c) => stageOf(c) === NONE),
  );

  const drop = (stage: string) => {
    const id = dragging;
    setDragging(null);
    setOver(null);
    const card = cards.find((c) => c.id === id);
    if (!card || stageOf(card) === stage) return;
    setMoved((m) => ({ ...m, [card.id]: stage }));
    start(async () => {
      const result = await save(card.id, field, stage || null);
      if (!result?.ok) toast?.({ ok: false, message: result?.message ?? "No se ha podido mover." });
      setMoved(({ [card.id]: _, ...rest }) => rest);
    });
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="flex min-h-96 gap-3">
        {lists.map((list) => {
          const inList = cards.filter((c) => stageOf(c) === list.key);
          return (
            <section
              key={list.key || "none"}
              aria-label={list.label}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(list.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(list.key);
              }}
              className={cx(
                "flex w-72 shrink-0 flex-col rounded-xl bg-ink-50 p-2 transition-shadow",
                over === list.key && "ring-2 ring-accent/40",
              )}
            >
              <h3 className="flex items-center justify-between px-1.5 pt-1 pb-2 text-sm font-medium">
                <span className={cx("truncate", list.key === NONE && "text-muted")}>{list.label}</span>
                <span className="text-xs text-muted tabular-nums">{inList.length}</span>
              </h3>
              <ul className="flex flex-1 flex-col gap-2">
                {inList.map((card) => (
                  <li
                    key={card.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", card.id);
                      setDragging(card.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    className={cx(
                      "cursor-grab rounded-lg border border-border bg-surface shadow-xs transition hover:border-border-strong active:cursor-grabbing",
                      dragging === card.id && "opacity-50",
                      card.discarded && "opacity-60",
                    )}
                  >
                    <Link href={card.href} scroll={false} draggable={false} className="block space-y-1.5 p-3">
                      <span className="flex items-baseline gap-2">
                        <span className="text-xs text-muted tabular-nums">{card.seq}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{card.name}</span>
                      </span>
                      {card.details.map((d) => (
                        <span key={d} className="block truncate text-xs text-muted">
                          {d}
                        </span>
                      ))}
                      {card.fitScore != null ? (
                        <span className="flex items-center gap-2 text-xs text-muted tabular-nums">
                          <span className="h-1.5 w-10 overflow-hidden rounded-full bg-ink-100">
                            <span
                              className="block h-full bg-brand-500"
                              style={{ width: `${Math.max(0, Math.min(100, card.fitScore))}%` }}
                            />
                          </span>
                          Encaje {card.fitScore}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
