import { NextResponse } from "next/server";
import { rowsAdded } from "@/server/agents/events";
import { workOnAddedRows } from "@/server/agents/runtime";
import { getDb } from "@/server/db/client";
import { intakeRow } from "@/server/prospects/intake";

/**
 * Public endpoint that adds a row to one table: a form on the team's
 * website, or any tool that can POST. JSON, urlencoded or multipart.
 * Authenticated by the table's key (header x-salesmate-key, field _key or
 * ?key=). `_redirect` sends the visitor back to a page; `_gotcha` is a
 * honeypot. If an agent completes the table's new rows, it runs right after.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-salesmate-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await request.json()) as Record<string, unknown>;
  const form = await request.formData();
  const out: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) {
    if (typeof v !== "string") continue;
    out[k] = k in out ? [out[k], v].flat() : v;
  }
  return out;
}

export async function POST(request: Request, ctx: RouteContext<"/api/tables/[baseId]/rows">) {
  const { baseId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(baseId))
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });

  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: CORS });
  }
  const key =
    request.headers.get("x-salesmate-key") ??
    (typeof body._key === "string" ? body._key : null) ??
    new URL(request.url).searchParams.get("key");
  const redirectTo =
    typeof body._redirect === "string" && /^https?:\/\//.test(body._redirect) ? body._redirect : null;
  const respond = (status: number, json: Record<string, unknown>) =>
    redirectTo && status < 300
      ? NextResponse.redirect(redirectTo, 303)
      : NextResponse.json(json, { status, headers: CORS });

  // Honeypot: bots fill hidden fields that people never see.
  if (typeof body._gotcha === "string" && body._gotcha.trim() !== "") return respond(200, { ok: true });

  const fields = Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith("_")));
  const db = getDb();
  const result = await intakeRow(db, { baseId, key, fields });
  if (result.status === "unauthorized") return respond(401, { error: "unauthorized" });
  if (result.status === "invalid")
    return respond(400, { error: "invalid", message: result.message, ignored: result.ignored });
  if (result.status === "duplicate")
    return respond(200, { ok: true, duplicate: true, ignored: result.ignored });

  const tenant = { orgId: result.orgId };
  workOnAddedRows(tenant, await rowsAdded(db, tenant, { baseId, rowIds: [result.rowId] }));
  return respond(201, { ok: true, id: result.rowId, ignored: result.ignored });
}
