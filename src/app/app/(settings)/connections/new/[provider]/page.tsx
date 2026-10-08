import { redirect } from "next/navigation";

/** Old address: connecting now happens in a modal on «Conexiones», opened on the tool. */
export default async function ConnectProviderPage({ params }: PageProps<"/app/connections/new/[provider]">) {
  const { provider } = await params;
  redirect(`/app/connections?add=${encodeURIComponent(provider)}`);
}
