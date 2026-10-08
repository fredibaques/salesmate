"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Select } from "@/components/ui";
import { listTargetsAction, setTaskTargetAction } from "./actions";

type Target = { id: string; label: string };

/** The bases, lists or boards of a connection, loaded when shown. */
export function useTargets(connectionId: string | null) {
  const [state, setState] = useState<{ id: string | null; targets: Target[] | null; error?: string }>({
    id: null,
    targets: null,
  });
  useEffect(() => {
    if (!connectionId) return;
    let alive = true;
    void listTargetsAction(connectionId).then((r) => {
      if (alive) setState({ id: connectionId, targets: r.targets, error: r.ok ? undefined : r.message });
    });
    return () => {
      alive = false;
    };
  }, [connectionId]);
  // Until the answer for this connection arrives, it is loading.
  return state.id === connectionId ? state : { targets: null, error: undefined };
}

/** Where the agents' tasks go for a Trello or monday.com connection. */
export function TaskTargetForm({ connectionId, current }: { connectionId: string; current: Target | null }) {
  const { targets, error } = useTargets(connectionId);
  const [label, setLabel] = useState(current?.label ?? "");
  if (error) return <p className="text-xs text-danger">{error}</p>;
  if (!targets)
    return (
      <p className="flex items-center gap-2 text-xs text-muted">
        <Loader2 className="size-3.5 animate-spin" /> Cargando…
      </p>
    );
  return (
    <ActionForm
      action={setTaskTargetAction.bind(null, connectionId)}
      submitLabel="Guardar"
      submitVariant="secondary"
      className="flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="targetLabel" value={label} />
      <Select
        name="target"
        defaultValue={current?.id ?? ""}
        onChange={(e) => setLabel(e.target.selectedOptions[0]?.textContent ?? "")}
        className="max-w-xs"
      >
        <option value="">Sin tareas de agentes</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </Select>
    </ActionForm>
  );
}
