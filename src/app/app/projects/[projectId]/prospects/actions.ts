"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { setProspectStatus } from "@/server/prospects/service";

/** Discards a row, or brings it back. Any member of the organization can. */
export async function changeProspectStatus(
  projectId: string,
  baseId: string,
  ids: string[],
  status: "new" | "discarded",
) {
  const tenant = await requireTenant();
  await setProspectStatus(getDb(), tenant, baseId, ids, status);
  revalidatePath(`/app/projects/${projectId}/prospects/${baseId}`);
}
