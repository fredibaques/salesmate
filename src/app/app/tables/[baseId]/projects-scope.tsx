"use client";

import { useState } from "react";
import { Choice, Segmented } from "@/components/ui";

/**
 * Which projects use a table: every project of the account, or the ones
 * picked (one makes it that project's; several share it).
 */
export function ProjectsScope({
  projects,
  picked,
}: {
  projects: { id: string; name: string }[];
  /** The projects that use it now; empty = every project. */
  picked: string[];
}) {
  const [scope, setScope] = useState(picked.length ? "some" : "all");
  return (
    <div className="space-y-3">
      <Segmented
        name="scope"
        options={[
          { value: "all", label: "Todos los proyectos" },
          { value: "some", label: "Solo algunos" },
        ]}
        defaultValue={scope}
        onChange={setScope}
      />
      {scope === "some" ? (
        <div className="space-y-2">
          {projects.map((p) => (
            <Choice
              key={p.id}
              name="projectIds"
              value={p.id}
              label={p.name}
              defaultChecked={picked.includes(p.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
