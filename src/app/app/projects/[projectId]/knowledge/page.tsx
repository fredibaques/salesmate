import { BookOpen } from "lucide-react";
import Link from "next/link";
import { InfoTip } from "@/components/tooltip";
import { Card, EmptyState, Toolbar } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listKnowledge } from "@/server/services/projects";
import { AddKnowledge, SourceCards } from "../../../knowledge/knowledge-view";
import { askKnowledge } from "../actions";
import { AskBox } from "./ask-box";

export const metadata = { title: "Conocimiento" };

/** What the project's agents know: the project's own knowledge and the account's. */
export default async function KnowledgePage({ params }: PageProps<"/app/projects/[projectId]/knowledge">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [sources, account] = await Promise.all([
    listKnowledge(db, tenant, projectId),
    listKnowledge(db, tenant, null),
  ]);
  const accountSection =
    account.length > 0 ? (
      <section className="space-y-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          De toda la cuenta
          <InfoTip>Lo usan todos los proyectos. Se gestiona en Conocimiento, en el menú.</InfoTip>
          <Link href="/app/knowledge" className="ml-auto text-xs font-normal text-accent hover:underline">
            Gestionar
          </Link>
        </h2>
        <SourceCards sources={account} />
      </section>
    ) : null;

  return (
    <>
      <Toolbar>{sources.length > 0 ? <AddKnowledge projectId={projectId} /> : null}</Toolbar>

      {sources.length === 0 && account.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="Los agentes todavía no saben nada de este proyecto"
          description="Sube tus tarifas, presentaciones, condiciones o ejemplos de emails. Con eso responden con datos reales y citan de dónde los sacan. Lo que valga para todos los proyectos, súbelo en Conocimiento, en el menú."
          action={<AddKnowledge projectId={projectId} />}
        />
      ) : (
        <div className="space-y-6">
          <Card
            title="Pregúntale al conocimiento"
            tip="Comprueba qué respondería un agente: contesta solo con lo que hay aquí (del proyecto y de toda la cuenta) y te dice de dónde sale."
          >
            <AskBox projectId={projectId} action={askKnowledge.bind(null, projectId)} />
          </Card>

          <section className="space-y-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              De este proyecto
              <InfoTip>Solo lo usan los agentes de este proyecto.</InfoTip>
            </h2>
            {sources.length > 0 ? (
              <SourceCards sources={sources} />
            ) : (
              <EmptyState
                compact
                title="Nada propio todavía"
                description="Los agentes usan el conocimiento de toda la cuenta. Añade aquí lo que sea solo de este proyecto."
                action={<AddKnowledge projectId={projectId} />}
              />
            )}
          </section>

          {accountSection}
        </div>
      )}
    </>
  );
}
