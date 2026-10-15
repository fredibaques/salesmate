"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { noticesSeen, topBarState, type TopBarState } from "./actions";
import { CopilotPanel } from "./copilot-panel";
import { Notices } from "./notices";
import { WorkingAgents } from "./working-agents";

/** How often the bar asks again while the page is visible. */
const REFRESH_MS = 20_000;

/**
 * The right side of the top bar, on every page: the agents working now, the
 * notices and the Copilot. It starts from what the layout read and keeps
 * itself up to date (on each navigation and every few seconds).
 */
export function TopBarActions({
  initial,
  projects,
}: {
  initial: TopBarState;
  projects: { id: string; name: string }[];
}) {
  const pathname = usePathname();
  const [state, setState] = useState(initial);

  const reload = useCallback(() => {
    topBarState()
      .then(setState)
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") reload();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [pathname, reload]);

  // Opening the bell: what it shows is no longer new (what still waits for someone keeps counting).
  const onOpenNotices = useCallback(() => {
    setState((s) => ({ ...s, unread: s.notices.filter((n) => !n.key.startsWith("run:")).length }));
    noticesSeen().catch(() => {});
  }, []);

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <WorkingAgents agents={state.working} now={state.now} />
      <Notices notices={state.notices} unread={state.unread} now={state.now} onOpen={onOpenNotices} />
      <CopilotPanel projects={projects} />
    </div>
  );
}
