import { redirect } from "next/navigation";

/** «Oferta y cliente» now lives in the project's Ajustes. */
export default async function OfferPage({ params }: PageProps<"/app/projects/[projectId]/offer">) {
  const { projectId } = await params;
  redirect(`/app/projects/${projectId}/settings#oferta`);
}
