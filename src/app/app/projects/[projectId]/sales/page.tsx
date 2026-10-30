import Link from "@/components/link";
import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, Notice } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getBusinessProfile, getProjectAudience } from "@/server/services/business";
import { GoalFields } from "../../profile-fields";
import { saveGoal } from "../offer/actions";
import { ConfigNav } from "../section-navs";

export const metadata = { title: "Objetivo y público" };

/** What the project is for and who it's for; what the business sells is in «Tu negocio». */
export default async function ProjectGoalPage({ params }: PageProps<"/app/projects/[projectId]/sales">) {
  const { projectId } = await params;
  const tenant = await requireTenant();
  const db = getDb();
  const [{ goal, audience }, business] = await Promise.all([
    getProjectAudience(db, tenant, projectId),
    getBusinessProfile(db, tenant),
  ]);

  return (
    <>
      <ConfigNav projectId={projectId} />
      <div className="max-w-3xl space-y-6">
        {business?.offer ? null : (
          <Notice
            tone="warning"
            action={
              <Link href="/app/business" className={buttonClass({ variant: "secondary", size: "sm" })}>
                Describir mi negocio
              </Link>
            }
          >
            Los agentes aún no saben qué vendes ni cómo hablar: descríbelo en Tu negocio.
          </Notice>
        )}
        <Card
          title="Objetivo y público"
          tip="Lo propio de este proyecto. Qué vendes, tu cliente y cómo hablar son de tu negocio y valen para todos los proyectos."
          actions={
            <Link href="/app/business" className={buttonClass({ variant: "ghost", size: "sm" })}>
              Tu negocio
            </Link>
          }
        >
          <ActionForm
            key={JSON.stringify({ goal, audience })}
            action={saveGoal.bind(null, projectId)}
            submitLabel="Guardar"
            className="space-y-5"
          >
            <GoalFields goal={goal} audience={audience} business={business} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
