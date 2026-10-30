import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate for the app area: no session cookie → sign in.
 * Real authorization happens in every page and server action (requireTenant).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Only full page loads: client navigations, refreshes and prefetches (the
// `rsc` header) skip it, since each is a function run of its own and the page
// checks the session anyway.
export const config = {
  matcher: [
    { source: "/app/:path*", missing: [{ type: "header", key: "rsc" }] },
    { source: "/onboarding", missing: [{ type: "header", key: "rsc" }] },
  ],
};
