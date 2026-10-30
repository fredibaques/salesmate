import { Building2, User } from "lucide-react";
import Link from "@/components/link";
import { LinkRow } from "@/components/link-row";
import { Card, Table, Td } from "@/components/ui";
import { formatDateTime, plural } from "@/lib/format";
import type { listAllBases } from "@/server/prospects/bases";

type Row = Awaited<ReturnType<typeof listAllBases>>[number];

/**
 * Tables as rows: name, project, rows, cells left to fill, who fills it and
 * the last activity. The «Tablas» section and a project's tab show the same.
 */
export function TablesList({
  bases,
  pending,
  showProject = true,
}: {
  bases: Row[];
  /** Cells left to fill, by table (same order). */
  pending: number[];
  showProject?: boolean;
}) {
  return (
    <Card>
      <Table
        head={[
          "Tabla",
          ...(showProject ? ["Proyecto"] : []),
          "Filas",
          "Por completar",
          "La rellena",
          "Última actividad",
        ]}
      >
        {bases.map((b, i) => (
          <LinkRow key={b.id} href={`/app/tables/${b.id}`}>
            <Td>
              <Link
                href={`/app/tables/${b.id}`}
                className="inline-flex items-center gap-2 font-medium group-hover:text-accent"
              >
                {b.rowKind === "person" ? (
                  <User className="size-4 text-muted" aria-hidden />
                ) : (
                  <Building2 className="size-4 text-muted" aria-hidden />
                )}
                {b.name}
              </Link>
            </Td>
            {showProject ? <Td className="text-muted">{b.projectName ?? "Todos los proyectos"}</Td> : null}
            <Td className="tabular-nums">{plural(b.rows, "fila", "filas")}</Td>
            <Td className="tabular-nums">
              {pending[i] ? pending[i] : <span className="text-muted">—</span>}
            </Td>
            <Td className="text-muted">
              {b.agents.length ? b.agentNames.join(", ") : "A mano o formulario"}
            </Td>
            <Td className="whitespace-nowrap text-muted">{formatDateTime(b.lastActivity)}</Td>
          </LinkRow>
        ))}
      </Table>
    </Card>
  );
}
