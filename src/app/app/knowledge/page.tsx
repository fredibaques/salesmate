import { BookOpen } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listKnowledge } from "@/server/services/projects";
import { AddKnowledge, SourceCards } from "./knowledge-view";

export const metadata = { title: "Conocimiento" };

/**
 * Knowledge of the whole account: what every project's agents know (the
 * company, its services, its prices…). What only one project needs goes
 * in that project's Conocimiento tab.
 */
export default async function AccountKnowledgePage() {
  const tenant = await requireTenant();
  const sources = await listKnowledge(getDb(), tenant, null);
  const canEdit = tenant.role !== "member";
  return (
    <>
      <PageHeader
        icon={<BookOpen />}
        title="Conocimiento"
        tip="Lo que sabe tu empresa y vale para todos los proyectos: los agentes de cada proyecto lo usan junto con el conocimiento propio del proyecto."
        actions={canEdit && sources.length > 0 ? <AddKnowledge projectId={null} /> : null}
      />
      {sources.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="Sube una vez lo que vale para todos los proyectos"
          description="Presentación de la empresa, tarifas generales, condiciones, preguntas frecuentes… Todos los proyectos lo usan; lo propio de cada uno se añade en su pestaña Conocimiento."
          action={canEdit ? <AddKnowledge projectId={null} /> : null}
        />
      ) : (
        <SourceCards sources={sources} />
      )}
    </>
  );
}
