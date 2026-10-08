import { redirect } from "next/navigation";

/** Copilot lives on the home page now; old links land there. */
export default function CopilotPage() {
  redirect("/app");
}
