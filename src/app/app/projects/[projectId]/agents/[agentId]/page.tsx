import { notFound } from "next/navigation";
import { requireAgent } from "./require-agent";
import { InboundSetup } from "./inbound-setup";
import { OutreachSetup } from "./outreach-setup";
import { ProspectingSetup } from "./prospecting-setup";

/** «Configuración»: every agent's setup on one screen. Its sales process is the project's. */
export default async function AgentHomePage({
  params,
}: PageProps<"/app/projects/[projectId]/agents/[agentId]">) {
  const { projectId, agentId } = await params;
  const { agent } = await requireAgent(projectId, agentId);
  const props = { projectId, agentId };
  switch (agent.config.agentType) {
    case "prospecting":
      return <ProspectingSetup {...props} />;
    case "outbound":
      return <OutreachSetup {...props} />;
    case "inbound":
      return <InboundSetup {...props} />;
  }
  notFound();
}
