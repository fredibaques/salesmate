import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { processInboundEvent } from "@/server/agents/inbound";
import { inboundDeps } from "@/server/agents/runtime";
import { getDb } from "@/server/db/client";
import { inboundEvents, projects } from "@/server/db/schema";
import { withSystem, withTenant } from "@/server/db/tenant";
import { orgLlm } from "@/server/llm/org-ai";

/**
 * Public endpoint for a project's web forms. Accepts JSON, urlencoded or
 * multipart bodies. Authenticated by the project's form key (header
 * x-salesmate-key, field _key or ?key=). The lead is queued and the inbound
 * agent runs right after the response is sent.
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

function sameKey(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function POST(request: Request, ctx: RouteContext<"/api/inbound/form/[projectId]">) {
  const { projectId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
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

  const db = getDb();
  const [project] = await withSystem(db, (tx) =>
    tx
      .select({ id: projects.id, orgId: projects.orgId, key: projects.inboundFormKey })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  );
  if (!project?.key || !key || !sameKey(project.key, key)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  const redirectTo =
    typeof body._redirect === "string" && /^https?:\/\//.test(body._redirect) ? body._redirect : null;
  const respond = () =>
    redirectTo ? NextResponse.redirect(redirectTo, 303) : NextResponse.json({ ok: true }, { headers: CORS });

  // Honeypot: bots fill hidden fields that people never see.
  if (typeof body._gotcha === "string" && body._gotcha.trim() !== "") return respond();

  const fields = Object.fromEntries(Object.entries(body).filter(([k]) => !k.startsWith("_")));
  const [event] = await withTenant(db, { orgId: project.orgId }, (tx) =>
    tx
      .insert(inboundEvents)
      .values({
        orgId: project.orgId,
        projectId: project.id,
        source: "form",
        eventType: "form.submitted",
        payload: { fields, page: request.headers.get("referer") },
      })
      .returning({ id: inboundEvents.id }),
  );

  // Without the organization's AI the event waits in the queue.
  const llm = await orgLlm(db, { orgId: project.orgId });
  if (llm) {
    after(async () => {
      await processInboundEvent(inboundDeps(llm), project.orgId, event.id);
    });
  }
  return respond();
}
