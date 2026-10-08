import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getSourceFile } from "@/server/knowledge/service";

/** The original uploaded file: inline (for the preview) or as a download with ?download. */
export async function GET(request: Request, ctx: RouteContext<"/app/knowledge/[sourceId]/file">) {
  const { sourceId } = await ctx.params;
  const tenant = await requireTenant();
  const file = await getSourceFile(getDb(), tenant, sourceId).catch(() => null);
  if (!file) return new Response("No encontrado", { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
