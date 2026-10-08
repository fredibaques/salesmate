"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { buttonClass, cx } from "@/components/ui";
import { saveMenu } from "../actions";

type Row = { key: string; label: ReactNode; icon?: ReactNode; extra?: ReactNode };
type ProjectRow = Row & { agents: Row[] };

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** One row with its up/down buttons. */
function OrderRow({
  row,
  index,
  count,
  onMove,
  nested = false,
}: {
  row: Row;
  index: number;
  count: number;
  onMove: (to: number) => void;
  nested?: boolean;
}) {
  const label = typeof row.label === "string" ? row.label : "elemento";
  const arrow = cx(buttonClass({ variant: "ghost", size: "sm", iconOnly: true }), "disabled:opacity-30");
  return (
    <div className={cx("flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-ink-50", nested && "pl-9")}>
      {row.icon ? <span className="flex shrink-0 items-center [&>svg]:size-4">{row.icon}</span> : null}
      <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
      {row.extra}
      <button
        type="button"
        className={arrow}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        aria-label={`Subir ${label}`}
      >
        <ArrowUp className="size-4" />
      </button>
      <button
        type="button"
        className={arrow}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        aria-label={`Bajar ${label}`}
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  );
}

/**
 * The order of the sidebar: its sections, the projects and each project's
 * agents. Saved for this person only.
 */
export function MenuEditor({
  sections: initialSections,
  projects: initialProjects,
}: {
  sections: Row[];
  projects: ProjectRow[];
}) {
  const [sections, setSections] = useState(initialSections);
  const [projects, setProjects] = useState(initialProjects);
  const nav = {
    sections: sections.map((s) => s.key),
    projects: projects.map((p) => p.key),
    agents: Object.fromEntries(projects.map((p) => [p.key, p.agents.map((a) => a.key)])),
  };
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Secciones</h3>
        {sections.map((row, i) => (
          <OrderRow
            key={row.key}
            row={row}
            index={i}
            count={sections.length}
            onMove={(to) => setSections(move(sections, i, to))}
          />
        ))}
      </section>
      <section>
        <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Proyectos y agentes</h3>
        {projects.length === 0 ? <p className="px-2 text-sm text-muted">Todavía no hay proyectos.</p> : null}
        {projects.map((project, i) => (
          <div key={project.key}>
            <OrderRow
              row={project}
              index={i}
              count={projects.length}
              onMove={(to) => setProjects(move(projects, i, to))}
            />
            {project.agents.map((agent, j) => (
              <OrderRow
                key={agent.key}
                nested
                row={agent}
                index={j}
                count={project.agents.length}
                onMove={(to) =>
                  setProjects(
                    projects.map((p) =>
                      p.key === project.key ? { ...p, agents: move(p.agents, j, to) } : p,
                    ),
                  )
                }
              />
            ))}
          </div>
        ))}
      </section>
      <ActionForm action={saveMenu} submitLabel="Guardar el orden">
        <input type="hidden" name="nav" value={JSON.stringify(nav)} />
      </ActionForm>
    </div>
  );
}
