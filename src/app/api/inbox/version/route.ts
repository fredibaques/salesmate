import { NextResponse } from "next/server";
import { requireTenant } from "@/server/auth/session";
import { inboxVersion } from "@/server/conversations/inbox";
import { getDb } from "@/server/db/client";

/** What the open inbox polls (see `AutoRefresh`): it renders again only when this changes. */
export async function GET() {
  const tenant = await requireTenant();
  return NextResponse.json(
    { version: await inboxVersion(getDb(), tenant) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
