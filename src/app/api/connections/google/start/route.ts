import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/server/auth/session";
import { googleAuthUrl, GOOGLE_SCOPE_SETS, type GoogleScopeSet } from "@/server/connectors/google";
import { sign } from "@/server/crypto";
import { env } from "@/server/env";
import { isGoogleTool, type GoogleTool } from "@/lib/integrations";

/** What each Google tool asks for when the form doesn't say. */
const TOOL_SETS: Record<GoogleTool, GoogleScopeSet[]> = {
  gmail: ["gmail_write"],
  google_calendar: ["calendar_read"],
  google_meet: ["meet_read"],
  google_docs: ["docs_read"],
  google_sheets: ["sheets"],
};

export async function GET(request: NextRequest) {
  const tenant = await requireRole(["owner", "admin"]);
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = env();
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/app/connections?error=google_not_configured", request.url));
  }
  // The form may send several "sets" values, each a comma-separated list.
  const sets = [
    ...new Set(
      request.nextUrl.searchParams
        .getAll("sets")
        .flatMap((v) => v.split(","))
        .filter((s): s is GoogleScopeSet => s in GOOGLE_SCOPE_SETS),
    ),
  ];
  // The Google tool being connected (Gmail, Calendar…): only it is turned on.
  const toolParam = request.nextUrl.searchParams.get("tool") ?? "";
  const tool = isGoogleTool(toolParam) ? toolParam : undefined;
  const nonce = randomBytes(16).toString("hex");
  const state = sign(
    JSON.stringify({
      orgId: tenant.orgId,
      userId: tenant.userId,
      nonce,
      exp: Date.now() + 10 * 60_000,
      tool,
    }),
  );
  (await cookies()).set("sm_google_oauth", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: APP_URL.startsWith("https://"),
    maxAge: 600,
    path: "/api/connections/google",
  });
  const url = googleAuthUrl(
    {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: `${APP_URL}/api/connections/google/callback`,
    },
    sets.length ? sets : tool ? TOOL_SETS[tool] : ["calendar_read"],
    state,
    request.nextUrl.searchParams.get("hint") ?? undefined,
  );
  return NextResponse.redirect(url);
}
