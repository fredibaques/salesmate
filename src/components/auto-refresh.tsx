"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Brings fresh data from the server while the page is visible. Each refresh
 * renders the whole page again on the server, so with `watch` (an endpoint
 * answering `{ version }`) it asks that first and refreshes only when the
 * version changes, or after `staleSeconds` without one; while nothing
 * changes it asks less and less often, up to every `maxSeconds`. Coming back
 * to the tab checks at once.
 */
export function AutoRefresh({
  seconds = 15,
  watch,
  maxSeconds = 60,
  staleSeconds = 300,
}: {
  seconds?: number;
  watch?: string;
  maxSeconds?: number;
  staleSeconds?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    let timer: number | undefined;
    let delay = seconds;
    let seen: string | null = null;
    let refreshedAt = Date.now();
    let busy = false;
    let stopped = false;

    /** Whether the watched version moved since the last look (the first look only records it). */
    const changed = async () => {
      if (!watch) return true;
      try {
        const response = await fetch(watch, { cache: "no-store", redirect: "manual" });
        if (!response.ok) return false;
        const { version } = (await response.json()) as { version: string };
        const before = seen;
        seen = version;
        return before !== null && before !== version;
      } catch {
        return false;
      }
    };

    const tick = async () => {
      window.clearTimeout(timer);
      if (busy) return;
      busy = true;
      if (document.visibilityState === "visible") {
        const first = watch && seen === null;
        if (await changed()) {
          delay = seconds;
          refreshedAt = Date.now();
          router.refresh();
        } else if (Date.now() - refreshedAt >= staleSeconds * 1000) {
          refreshedAt = Date.now();
          router.refresh();
        } else if (!first) {
          delay = Math.min(delay * 1.5, maxSeconds);
        }
      }
      busy = false;
      if (!stopped) timer = window.setTimeout(tick, delay * 1000);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    // With a watch, take its version now: what changes from here on shows.
    timer = window.setTimeout(tick, watch ? 0 : seconds * 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds, watch, maxSeconds, staleSeconds]);
  return null;
}
