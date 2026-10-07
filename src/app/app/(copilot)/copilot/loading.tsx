import { ChatSkeleton } from "@/components/skeleton";
import { PageHeader } from "@/components/ui";
import { COPILOT_TIP } from "../tips";

export default function Loading() {
  return (
    <>
      <PageHeader title="Copilot" tip={COPILOT_TIP} />
      <ChatSkeleton />
    </>
  );
}
