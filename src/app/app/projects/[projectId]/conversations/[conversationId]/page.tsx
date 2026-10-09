import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/auth/session";
import { personKey } from "@/server/conversations/inbox";
import { getDb } from "@/server/db/client";
import { getConversation } from "@/server/services/sales";

/** Old address of a conversation: it opens in the project's inbox, on its person. */
export default async function ConversationPage({
  params,
}: PageProps<"/app/projects/[projectId]/conversations/[conversationId]">) {
  const { projectId, conversationId } = await params;
  const tenant = await requireTenant();
  const data = await getConversation(getDb(), tenant, conversationId);
  if (!data) notFound();
  const key = personKey(data.conversation, data.contact);
  redirect(`/app/projects/${projectId}/conversations?c=${encodeURIComponent(key)}`);
}
