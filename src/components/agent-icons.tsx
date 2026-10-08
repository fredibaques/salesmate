import { HeartHandshake, MessageSquareReply, Send } from "lucide-react";
import type { ReactNode } from "react";

/** The icon of each kind of agent, in its card, its page and the sidebar. */
export const AGENT_ICONS: Record<"inbound" | "outbound" | "account_manager", ReactNode> = {
  inbound: <MessageSquareReply />,
  outbound: <Send />,
  account_manager: <HeartHandshake />,
};
