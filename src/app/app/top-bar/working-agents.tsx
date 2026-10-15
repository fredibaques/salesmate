"use client";

import Link from "next/link";
import { AgentStatusDot, AgentTile } from "@/components/agent-look-fields";
import { Popover } from "@/components/popover";
import { ProgressBar } from "@/components/progress-bar";
import { timeAgo } from "@/lib/format";
import type { WorkingAgent } from "@/server/services/top-bar";

/**
 * The agents working right now, as their stacked avatars and a count. It
 * opens what each one is doing, with how far along it is; nothing shows
 * while no agent works.
 */
export function WorkingAgents({ agents, now }: { agents: WorkingAgent[]; now: Date }) {
  if (!agents.length) return null;
  const label = agents.length === 1 ? "1 agente trabajando" : `${agents.length} agentes trabajando`;
  return (
    <Popover
      align="end"
      width="md"
      triggerLabel={label}
      triggerClassName="flex h-9 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-ink-100"
      trigger={
        <>
          <span className="flex -space-x-2">
            {agents.slice(0, 3).map((a) => (
              <span key={a.id} className="rounded-lg ring-2 ring-background">
                <AgentTile type={a.agentType} icon={a.icon} color={a.color} size="sm" state="working" />
              </span>
            ))}
          </span>
          <span className="hidden items-center gap-1.5 text-sm font-medium sm:flex">
            <AgentStatusDot state="working" />
            {agents.length} trabajando
          </span>
        </>
      }
    >
      {(close) => (
        <div className="space-y-4">
          <p className="font-semibold">Trabajando ahora</p>
          <ul className="space-y-4">
            {agents.map((a) => (
              <li key={a.id} className="space-y-2">
                <Link
                  href={`/app/projects/${a.projectId}/agents/${a.id}`}
                  onClick={close}
                  className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-ink-50"
                >
                  <AgentTile type={a.agentType} icon={a.icon} color={a.color} size="sm" state="working" />
                  <span className="truncate font-medium">{a.label}</span>
                </Link>
                <ul className="space-y-3 border-l-2 border-ink-100 pl-3">
                  {a.tasks.map((t) => (
                    <li key={t.key} className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span>{t.title}</span>
                        {t.startedAt ? (
                          <span className="shrink-0 text-xs text-muted">{timeAgo(t.startedAt, now)}</span>
                        ) : null}
                      </div>
                      {t.progress ? <ProgressBar progress={t.progress} live /> : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Popover>
  );
}
