"use client";

import { Plus } from "lucide-react";
import { ModalButton } from "@/components/modal";
import type { ButtonVariant } from "@/components/ui";
import { NewTableForm } from "./new-table-form";

/** «Nueva tabla»: a short form in a modal; the table opens ready to add columns and rows. */
export function NewTableButton({
  projectId,
  projects,
  variant = "primary",
  size,
  iconOnly,
}: {
  projectId?: string;
  projects?: { id: string; name: string }[];
  variant?: ButtonVariant;
  size?: "sm" | "md";
  iconOnly?: boolean;
}) {
  return (
    <ModalButton
      label="Nueva tabla"
      icon={<Plus className="size-4" />}
      title="Nueva tabla"
      variant={variant}
      size={size}
      iconOnly={iconOnly}
    >
      <NewTableForm projectId={projectId} projects={projects} />
    </ModalButton>
  );
}
