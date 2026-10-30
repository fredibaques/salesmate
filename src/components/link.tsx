"use client";

import NextLink from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * `next/link` that prefetches on intent (hover, focus, touch) instead of on
 * entering the viewport. Every `router.refresh()` (AutoRefresh while an
 * agent works) prefetched every visible link again: the sidebar, each table
 * row, each sort header, one request (and function run) apiece. Use this
 * everywhere instead of `next/link`; an explicit `prefetch` still wins.
 */
export default function Link({
  prefetch,
  onMouseEnter,
  onFocus,
  onTouchStart,
  ...props
}: ComponentProps<typeof NextLink>) {
  const [intent, setIntent] = useState(false);
  return (
    <NextLink
      {...props}
      prefetch={prefetch !== undefined ? prefetch : intent ? null : false}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}
