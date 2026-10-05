import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, Table, Td } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { queryTable } from "@/server/knowledge/service";

export default async function TablePreviewPage({
  params,
}: PageProps<"/app/projects/[projectId]/knowledge/tables/[tableId]">) {
  const { projectId, tableId } = await params;
  const tenant = await requireTenant();
  const result = await queryTable(getDb(), tenant, { tableId, limit: 200 }).catch(() => null);
  if (!result) notFound();

  return (
    <Card
      title={result.table.name}
      description={
        <>
          De «{result.source.name}» ·{" "}
          {result.source.reliability === "truth" ? "fuente de verdad" : "orientativa"} ·{" "}
          <Link href={`/app/projects/${projectId}/knowledge`} className="text-accent hover:underline">
            volver
          </Link>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {result.table.columns.map((c) => (
          <Badge key={c.key}>
            {c.label} → <code className="ml-1">{c.key}</code> · {c.type}
          </Badge>
        ))}
      </div>
      <Table head={result.table.columns.map((c) => c.label)}>
        {result.rows.map((r) => (
          <tr key={r.id}>
            {result.table.columns.map((c) => (
              <Td key={c.key}>{r.data[c.key] === null ? "—" : String(r.data[c.key])}</Td>
            ))}
          </tr>
        ))}
      </Table>
      {result.rows.length === 200 ? (
        <p className="mt-2 text-xs text-muted">Mostrando las primeras 200 filas.</p>
      ) : null}
    </Card>
  );
}
