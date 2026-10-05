import { Tabs, TabLink } from "@/components/nav-link";
import { CountBadge } from "@/components/sidebar";
import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listActions } from "@/server/services/projects";

/** Copilot: ask about your projects and decide on what the agents propose. */
export default async function CopilotLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireTenant();
  const pending = await listActions(getDb(), tenant, { statuses: ["pending_approval"], limit: 500 });
  return (
    <>
      <PageHeader className="mb-4" title="Copilot" />
      <Tabs>
        <TabLink href="/app/copilot">Asistente</TabLink>
        <TabLink href="/app/inbox" badge={<CountBadge count={pending.length} />}>
          Por aprobar
        </TabLink>
      </Tabs>
      {children}
    </>
  );
}
