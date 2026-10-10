import { HeartHandshake, MessageSquareReply, Radar, Send } from "lucide-react";
import type { ReactNode } from "react";

/** The icon of each kind of agent, in its card, its page and the sidebar. */
export const AGENT_ICONS: Record<"prospecting" | "inbound" | "outbound" | "account_manager", ReactNode> = {
  prospecting: <Radar />,
  inbound: <MessageSquareReply />,
  outbound: <Send />,
  account_manager: <HeartHandshake />,
};
