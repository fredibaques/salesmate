"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A section's header and tabs (a project, Configuración), shown only on the
 * section's own pages. Deeper pages (an agent, a document, a new connection)
 * have their own header, and the breadcrumbs already say where they are, so
 * the section's chrome would be a second title. `fallback` replaces it there.
 */
export function SectionChrome({
  children,
  maxDepth = 1,
  fallback = null,
}: {
  children: ReactNode;
  /** How many segments below the section still count as its own pages. */
  maxDepth?: number;
  fallback?: ReactNode;
}) {
  const depth = useSelectedLayoutSegments().filter(
    (s) => !s.startsWith("(") && !s.startsWith("__PAGE__"),
  ).length;
  return <>{depth <= maxDepth ? children : fallback}</>;
}
