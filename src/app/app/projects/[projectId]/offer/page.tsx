import { redirect } from "next/navigation";

/** The old «Oferta y cliente» address: the project's goal and audience are in its Ventas tab. */
export default async function OfferPage({ params }: PageProps<"/app/projects/[projectId]/offer">) {
  const { projectId } = await params;
  redirect(`/app/projects/${projectId}/sales`);
}
