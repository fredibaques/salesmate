import { notFound } from "next/navigation";

/** Fallback for the page slot when only the breadcrumbs slot matches a URL. */
export default function AppDefault() {
  notFound();
}
