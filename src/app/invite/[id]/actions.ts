"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { getAuth } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { runForm } from "@/server/form";
import { acceptInvitation } from "@/server/services/team";

/** Joins the invitation's organization and opens it. */
export async function acceptInvitationAction(invitationId: string, _: FormState): Promise<FormState> {
  const session = await requireUser();
  let orgId: string | null = null;
  const result = await runForm(async () => {
    orgId = await acceptInvitation(getDb(), session.user, invitationId);
  });
  if (!orgId) return result;
  await getAuth().api.setActiveOrganization({ headers: await headers(), body: { organizationId: orgId } });
  redirect("/app");
}
