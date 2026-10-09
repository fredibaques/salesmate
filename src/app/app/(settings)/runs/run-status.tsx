import { Badge } from "@/components/ui";

const RUN_STATUS = {
  running: { label: "En marcha", tone: "accent" },
  completed: { label: "Terminada", tone: "success" },
  failed: { label: "Con errores", tone: "danger" },
  refused: { label: "Rechazada", tone: "warning" },
} as const;

export function RunStatus({ status }: { status: keyof typeof RUN_STATUS }) {
  const s = RUN_STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
