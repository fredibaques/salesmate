import { NextResponse } from "next/server";
import { rowsAdded } from "@/server/agents/events";
import { workOnAddedRows } from "@/server/agents/runtime";
import { getDb } from "@/server/db/client";
import { intakeKeyOf, intakeRow, parseIntakeBody, recordIntakeAttempt } from "@/server/prospects/intake";

/**
 * Public endpoint that adds a row to one table: a form on the team's
 * website, or any tool that can POST. JSON (whatever its content type),
 * urlencoded or multipart. Authenticated by the table's key (header
 * x-salesmate-key or Authorization: Bearer, field _key or key, or ?key=).
 * `_redirect` sends the visitor back to a page; `_gotcha` is a honeypot.
 * Submissions that don't add a row are noted on the table with the reason.
 * If an agent completes the table's new rows, it runs right after.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-salesmate-key, x-api-key, api-key, apikey, x-key",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) {
      if (typeof v !== "string") continue;
      out[k] = k in out ? [out[k], v].flat() : v;
    }
    return out;
  }
  return parseIntakeBody(await request.text(), type);
}

export async function POST(request: Request, ctx: RouteContext<"/api/tables/[baseId]/rows">) {
  const { baseId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(baseId))
    return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS });

  let body: Record<string, unknown> | null;
  try {
    body = await readBody(request);
  } catch {
    body = null;
  }
  const db = getDb();
  if (!body) {
    await recordIntakeAttempt(db, baseId, { outcome: "invalid_body" });
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: CORS });
  }
  const { keys, fields: keyFields } = intakeKeyOf({ headers: request.headers, body, url: request.url });
  const redirectTo =
    typeof body._redirect === "string" && /^https?:\/\//.test(body._redirect) ? body._redirect : null;
  const respond = (status: number, json: Record<string, unknown>) =>
    redirectTo && status < 300
      ? NextResponse.redirect(redirectTo, 303)
      : NextResponse.json(json, { status, headers: CORS });

  // Honeypot: bots fill hidden fields that people never see.
  if (typeof body._gotcha === "string" && body._gotcha.trim() !== "") return respond(200, { ok: true });

  const fields = Object.fromEntries(
    Object.entries(body).filter(([k]) => !k.startsWith("_") && !keyFields.includes(k)),
  );
  const result = await intakeRow(db, { baseId, key: keys, fields });
  if (result.status === "unauthorized") return respond(401, { error: "unauthorized" });
  if (result.status === "invalid")
    return respond(400, { error: "invalid", message: result.message, ignored: result.ignored });
  if (result.status === "duplicate")
    return respond(200, { ok: true, duplicate: true, ignored: result.ignored });

  const tenant = { orgId: result.orgId };
  workOnAddedRows(tenant, await rowsAdded(db, tenant, { baseId, rowIds: [result.rowId] }));
  return respond(201, { ok: true, id: result.rowId, ignored: result.ignored });
}
