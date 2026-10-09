import { ListPageSkeleton } from "@/components/skeleton";
import { PageHeader } from "@/components/ui";
import { INBOX_TIP } from "../tips";

export default function Loading() {
  return (
    <>
      <PageHeader title="Por aprobar" tip={INBOX_TIP} />
      <ListPageSkeleton header />
    </>
  );
}
