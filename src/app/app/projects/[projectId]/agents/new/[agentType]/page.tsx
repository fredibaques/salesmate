import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { AGENT_INFO } from "@/lib/agents";
import { requireRole } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { SALES_MOTIONS } from "@/server/db/schema";
import { PLAYBOOK_TEMPLATES } from "@/server/playbooks/spec";
import {
  AGENT_DEFAULTS,
  AVAILABLE_AGENT_TYPES,
  getAgent,
  isProjectAgentType,
  listChannelOptions,
  listMcpServers,
} from "@/server/services/agents";
import { AGENT_ICONS } from "../../agent-cards";
import { InboundWizard, OutboundWizard } from "./agent-wizard";

export const metadata = { title: "Nuevo agente" };

/** First configuration of an agent, step by step. Afterwards it is edited on its own page. */
export default async function NewAgentPage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/new/[agentType]">) {
  const { projectId, agentType } = await params;
  if (!isProjectAgentType(agentType) || !AVAILABLE_AGENT_TYPES.includes(agentType)) notFound();
  const tenant = await requireRole(["owner", "admin"]);
  const db = getDb();
  const existing = await getAgent(db, tenant, projectId, agentType);
  if (existing) redirect(`/app/projects/${projectId}/agents/${agentType}`);
  const info = AGENT_INFO[agentType];
  const base = `/app/projects/${projectId}`;

  return (
    <>
      <PageHeader
        level="section"
        back={{ href: base, label: "Agentes" }}
        icon={AGENT_ICONS[agentType]}
        title={`Añadir el ${info.name.toLowerCase()}`}
        tip={info.description}
      />
      {agentType === "outbound" ? (
        <OutboundWizard
          projectId={projectId}
          defaults={AGENT_DEFAULTS.outbound}
          servers={await listMcpServers(db, tenant)}
        />
      ) : (
        <InboundWizard
          projectId={projectId}
          options={await listChannelOptions(db, tenant)}
          templates={Object.fromEntries(
            SALES_MOTIONS.map((m) => [
              m,
              {
                objective: PLAYBOOK_TEMPLATES[m].objective,
                customerType: PLAYBOOK_TEMPLATES[m].customerType,
                nextSteps: PLAYBOOK_TEMPLATES[m].nextSteps,
              },
            ]),
          )}
        />
      )}
    </>
  );
}
