import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { exportProspectsCsv } from "@/server/prospects/service";

/** CSV of a prospect base with its columns (?include=pending for the rows not exported yet). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/app/projects/[projectId]/prospects/[baseId]/export">,
) {
  const { baseId } = await ctx.params;
  const tenant = await requireTenant();
  const include = new URL(request.url).searchParams.get("include") === "pending" ? "pending" : "all";
  const { csv } = await exportProspectsCsv(getDb(), tenant, baseId, include);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="prospectos-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
