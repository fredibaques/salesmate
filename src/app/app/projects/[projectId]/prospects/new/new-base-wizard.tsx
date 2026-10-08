"use client";

import { Building2, Loader2, RefreshCw, User } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Badge, Button, Choice, Field, Input, Notice, Textarea } from "@/components/ui";
import { Wizard, type WizardStep } from "@/components/wizard";
import { COLUMN_TYPE_LABELS, type ColumnDraft, type RowKind } from "@/lib/prospect-columns";
import type { ProposedColumn } from "@/server/prospects/propose-columns";
import { createBaseAction, proposeColumnsAction } from "../actions";
import { COLUMN_ICONS } from "../column-icons";

const ROW_KINDS: { value: RowKind; label: string; description: string; icon: ReactNode }[] = [
  {
    value: "company",
    label: "Una empresa",
    description: "No se repiten: misma web, o mismo nombre y ciudad, es la misma fila.",
    icon: <Building2 className="size-4" />,
  },
  {
    value: "person",
    label: "Una persona",
    description: "Con la empresa donde trabaja. No se repite la misma persona en la misma empresa.",
    icon: <User className="size-4" />,
  },
];

type Proposal = {
  /** The answers the columns were proposed for. */
  key: string;
  columns: ProposedColumn[];
  picked: boolean[];
  message?: string;
};

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

/**
 * Creating a base: what each row is, the columns (proposed by the AI from the
 * project's offer and ideal customer) and a last look before creating it.
 */
export function NewBaseWizard({ projectId }: { projectId: string }) {
  const [name, setName] = useState("");
  const [rowKind, setRowKind] = useState<RowKind>("company");
  const [brief, setBrief] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  const answers = JSON.stringify([rowKind, name.trim(), brief.trim()]);

  async function propose() {
    const id = ++request.current;
    setLoading(true);
    const result = await proposeColumnsAction(projectId, { rowKind, name: name.trim(), brief: brief.trim() });
    if (id !== request.current) return;
    setProposal({
      key: answers,
      columns: result.columns,
      picked: result.columns.map((c) => c.recommended),
      message: result.ok ? undefined : result.message,
    });
    setLoading(false);
  }

  const chosen: ColumnDraft[] = proposal
    ? proposal.columns
        .filter((_, i) => proposal.picked[i])
        .map(({ recommended: _recommended, ...column }) => column)
    : [];

  const steps: WizardStep[] = [
    {
      id: "what",
      title: "Qué guardas",
      content: (
        <>
          <Field label="Nombre de la tabla">
            <Input
              name="name"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="p. ej. Concesionarios de Andalucía"
            />
          </Field>
          <Field label="Cada fila es" group>
            <div className="grid gap-3 sm:grid-cols-2">
              {ROW_KINDS.map((k) => (
                <Choice
                  key={k.value}
                  type="radio"
                  card
                  name="rowKind"
                  value={k.value}
                  checked={rowKind === k.value}
                  onChange={() => setRowKind(k.value)}
                  label={
                    <span className="inline-flex items-center gap-2">
                      {k.icon}
                      {k.label}
                    </span>
                  }
                  description={k.description}
                />
              ))}
            </div>
          </Field>
          <Field
            label="Qué quieres saber de cada una"
            optional
            hint="La IA lo usa, junto con la oferta y el cliente ideal del proyecto, para proponer las columnas."
          >
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              className="min-h-24"
              placeholder="p. ej. Si tienen gestoría propia, cuántos coches venden y quién decide la compra."
            />
          </Field>
        </>
      ),
    },
    {
      id: "columns",
      title: "Columnas",
      summary: "Marca las que quieras. Podrás cambiarlas, añadir más u ocultarlas cuando quieras.",
      content: (
        <>
          <input type="hidden" name="columns" value={JSON.stringify(chosen)} />
          {loading || !proposal ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" />
              Pensando las columnas para tu cliente ideal…
            </p>
          ) : (
            <>
              {proposal.message ? (
                <Notice tone="warning">{proposal.message}</Notice>
              ) : (
                <Notice
                  action={
                    <Button type="button" variant="ghost" size="sm" onClick={propose}>
                      <RefreshCw />
                      Proponer otras
                    </Button>
                  }
                >
                  Propuestas a partir de la oferta y el cliente ideal del proyecto.
                </Notice>
              )}
              <div className="space-y-2">
                <Choice
                  checked
                  disabled
                  label={
                    rowKind === "person"
                      ? "Nombre, empresa, web, encaje, estado y fuentes"
                      : "Empresa, web, encaje, estado y fuentes"
                  }
                  description="Siempre están: identifican la fila, evitan duplicados y justifican lo que guarda el agente."
                  card
                  readOnly
                />
                {proposal.columns.map((c, i) => {
                  const Icon = COLUMN_ICONS[c.type];
                  return (
                    <Choice
                      key={`${c.name}-${i}`}
                      card
                      checked={proposal.picked[i]}
                      onChange={(e) =>
                        setProposal({
                          ...proposal,
                          picked: proposal.picked.map((p, j) => (j === i ? e.target.checked : p)),
                        })
                      }
                      label={
                        <span className="flex flex-wrap items-center gap-2">
                          <Icon className="size-4 text-muted" aria-hidden />
                          {c.name}
                          <Badge tone="neutral">
                            {COLUMN_TYPE_LABELS[c.type]}
                            {c.options?.length ? `: ${c.options.join(", ")}` : ""}
                          </Badge>
                          {c.filledBy === "person" ? <Badge tone="accent">La rellena el equipo</Badge> : null}
                        </span>
                      }
                      description={c.instructions}
                    />
                  );
                })}
              </div>
            </>
          )}
        </>
      ),
    },
    {
      id: "review",
      title: "Revisar",
      content: () => (
        <dl className="divide-y divide-border">
          <ReviewRow label="Nombre">{name}</ReviewRow>
          <ReviewRow label="Cada fila es">{rowKind === "person" ? "Una persona" : "Una empresa"}</ReviewRow>
          <ReviewRow label="Columnas">
            {chosen.length ? chosen.map((c) => c.name).join(" · ") : "Solo las fijas"}
          </ReviewRow>
          <ReviewRow label="Quién la rellena">
            Nadie todavía. Elige esta tabla en «Trabaja sobre», en la ficha del agente de prospección, o añade
            filas a mano.
          </ReviewRow>
        </dl>
      ),
    },
  ];

  return (
    <Wizard
      steps={steps}
      action={createBaseAction.bind(null, projectId)}
      submitLabel="Crear tabla"
      cancelHref={`/app/projects/${projectId}/prospects`}
      onStepChange={(index) => {
        // Propose again only when the answers that shape the columns changed.
        if (index === 1 && proposal?.key !== answers && !loading) void propose();
      }}
    />
  );
}
