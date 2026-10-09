"use client";

import { ArrowLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { AgentTile } from "@/components/agent-look-fields";
import { Badge, buttonClass } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import type { NextStep } from "@/server/playbooks/spec";
import type {
  AGENT_DEFAULTS,
  listChannelOptions,
  listMcpServers,
  ProjectAgentType,
} from "@/server/services/agents";
import { InboundWizard, OutboundWizard } from "./agent-wizard";

/**
 * «Añadir agente», inside its modal: first which kind of agent, then its
 * setup wizard, without leaving the project.
 */
export function NewAgentFlow({
  projectId,
  types,
  initial,
  options,
  servers,
  defaults,
  process,
}: {
  projectId: string;
  /** Kinds the project doesn't have yet, and whether each can be added today. */
  types: { type: ProjectAgentType; available: boolean }[];
  initial?: ProjectAgentType;
  options: Awaited<ReturnType<typeof listChannelOptions>>;
  servers: Awaited<ReturnType<typeof listMcpServers>>;
  defaults: (typeof AGENT_DEFAULTS)["outbound"];
  process: { objective: string; nextSteps: NextStep[] } | null;
}) {
  const [type, setType] = useState<ProjectAgentType | null>(initial ?? null);

  if (type) {
    return (
      <div className="space-y-4">
        {types.filter((t) => t.available).length > 1 ? (
          <button
            type="button"
            onClick={() => setType(null)}
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="size-4" />
            Otro tipo de agente
          </button>
        ) : null}
        {type === "outbound" ? (
          <OutboundWizard projectId={projectId} defaults={defaults} servers={servers} />
        ) : (
          <InboundWizard projectId={projectId} options={options} process={process} />
        )}
      </div>
    );
  }

  return (
    <ul className="grid gap-3">
      {types.map(({ type: t, available }) => {
        const info = AGENT_INFO[t];
        return (
          <li key={t}>
            <button
              type="button"
              disabled={!available}
              onClick={() => setType(t)}
              className="group flex w-full items-start gap-3 rounded-xl border border-border bg-surface p-4 text-left transition enabled:hover:border-border-strong enabled:hover:bg-background disabled:cursor-not-allowed disabled:border-dashed disabled:opacity-70"
            >
              <AgentTile type={t} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {info.name}
                  {available ? null : <Badge>Próximamente</Badge>}
                </span>
                <span className="mt-0.5 block text-sm text-muted">{info.description}</span>
              </span>
              {available ? (
                <ChevronRight className="mt-1 size-4 text-muted transition-transform group-hover:translate-x-0.5" />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
