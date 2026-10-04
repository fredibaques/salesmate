"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/auth";
import { requireUser } from "@/server/auth/session";

export async function switchOrganization(organizationId: string) {
  await requireUser();
  await getAuth().api.setActiveOrganization({ headers: await headers(), body: { organizationId } });
  redirect("/app");
}

export async function signOut() {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}
