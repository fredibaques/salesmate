import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { requireTenant } from "@/server/auth/session";
import { exchangeGoogleCode } from "@/server/connectors/google";
import { saveGoogleConnection } from "@/server/connectors/service";
import { verifySigned } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { GOOGLE_TOOLS, isGoogleTool } from "@/lib/integrations";

export async function GET(request: NextRequest) {
  const back = (query: string) => NextResponse.redirect(new URL(`/app/connections?${query}`, request.url));
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return back(`error=${encodeURIComponent(params.get("error")!)}`);

  const tenant = await requireTenant();
  const jar = await cookies();
  const nonce = jar.get("sm_google_oauth")?.value;
  jar.delete({ name: "sm_google_oauth", path: "/api/connections/google" });

  const raw = verifySigned(params.get("state") ?? "");
  const state = raw
    ? (JSON.parse(raw) as { orgId: string; userId: string; nonce: string; exp: number; tool?: string })
    : null;
  if (
    !state ||
    state.nonce !== nonce ||
    state.exp < Date.now() ||
    state.orgId !== tenant.orgId ||
    state.userId !== tenant.userId
  ) {
    return back("error=invalid_state");
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = env();
  try {
    const result = await exchangeGoogleCode(
      {
        clientId: GOOGLE_CLIENT_ID!,
        clientSecret: GOOGLE_CLIENT_SECRET!,
        redirectUri: `${APP_URL}/api/connections/google/callback`,
      },
      params.get("code") ?? "",
    );
    const tool = state.tool && isGoogleTool(state.tool) ? state.tool : undefined;
    await saveGoogleConnection({ db: getDb() }, tenant, { ...result, ownerUserId: tenant.userId, tool });
    const what = tool ? `${GOOGLE_TOOLS[tool].name} · ${result.email}` : result.email;
    return back(`connected=${encodeURIComponent(what)}`);
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "google_failed")}`);
  }
}
