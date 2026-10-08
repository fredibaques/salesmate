import { redirect } from "next/navigation";

/** Old address: connecting now happens in a modal on «Integraciones». */
export default function NewConnectionPage() {
  redirect("/app/connections?add=1");
}
