"use client";

import { AlertTriangle, Bell, CheckCircle2, Inbox } from "lucide-react";
import Link from "next/link";
import { Popover } from "@/components/popover";
import { cx } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { AppNotice } from "@/server/services/top-bar";

const TONE = {
  problem: { Icon: AlertTriangle, className: "text-warning" },
  attention: { Icon: Inbox, className: "text-accent" },
  done: { Icon: CheckCircle2, className: "text-success" },
} as const;

/**
 * The bell: what asks for attention (actions to approve, a connection that
 * fails) and how the agents' runs went. Its number counts what is new since
 * it was last opened, plus what still waits for someone.
 */
export function Notices({
  notices,
  unread,
  now,
  onOpen,
}: {
  notices: AppNotice[];
  unread: number;
  now: Date;
  onOpen: () => void;
}) {
  return (
    <Popover
      align="end"
      width="md"
      onOpen={onOpen}
      triggerLabel={unread ? `Avisos (${unread} nuevos)` : "Avisos"}
      triggerClassName="relative flex size-9 items-center justify-center rounded-lg text-ink-600 transition-colors hover:bg-ink-100 hover:text-foreground [&_svg]:size-[18px]"
      trigger={
        <>
          <Bell />
          {unread ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </>
      }
    >
      {(close) => (
        <div className="space-y-3">
          <p className="font-semibold">Avisos</p>
          {notices.length ? (
            <ul className="-mx-2 space-y-0.5">
              {notices.map((n) => {
                const { Icon, className } = TONE[n.tone];
                return (
                  <li key={n.key}>
                    <Link
                      href={n.href}
                      onClick={close}
                      className="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-ink-50"
                    >
                      <Icon className={cx("mt-0.5 size-4 shrink-0", className)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className={cx("block", n.unread && "font-medium")}>{n.title}</span>
                        {n.detail ? (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.detail}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                        {n.at ? timeAgo(n.at, now) : null}
                        {n.unread ? (
                          <span className="size-2 rounded-full bg-primary" aria-label="Nuevo" />
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-4 text-center text-muted">Todo en orden: no hay avisos.</p>
          )}
        </div>
      )}
    </Popover>
  );
}
