import { MessagesSquare } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listProjects } from "@/server/services/projects";
import { InboxView, type InboxQuery } from "./inbox-view";

export const metadata = { title: "Conversaciones" };

/** Every conversation of every project, one row per person. */
export default async function ConversationsPage({ searchParams }: PageProps<"/app/conversations">) {
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"),
  ) as InboxQuery;
  const tenant = await requireTenant();
  const projects = await listProjects(getDb(), tenant);
  return (
    <>
      <PageHeader
        icon={<MessagesSquare />}
        title="Conversaciones"
        tip="Lo que hablan tus agentes con cada persona, por email, WhatsApp o el formulario de tu web: una fila por persona, con todos sus canales juntos. Lo que un agente quiere enviar y espera tu visto bueno se aprueba aquí mismo."
        className="mb-4"
      />
      <InboxView
        tenant={tenant}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        query={query}
        basePath="/app/conversations"
        heightClass="h-[calc(100dvh-12rem)] min-h-[26rem] md:h-[calc(100dvh-8.5rem)]"
      />
    </>
  );
}
