"use client";

import { Plus } from "lucide-react";
import { ModalButton } from "@/components/modal";
import type { ButtonVariant } from "@/components/ui";
import { NewBaseWizard } from "./new-base-wizard";

/**
 * «Nueva tabla»: the step-by-step creation, in a modal. In a project it
 * belongs there; from «Tablas», the first step asks which project.
 */
export function NewTableButton({
  projectId,
  projects,
  variant = "primary",
}: {
  projectId?: string;
  projects?: { id: string; name: string }[];
  variant?: ButtonVariant;
}) {
  return (
    <ModalButton
      label="Nueva tabla"
      icon={<Plus className="size-4" />}
      title="Nueva tabla"
      variant={variant}
      width="xl"
    >
      <NewBaseWizard projectId={projectId} projects={projects} />
    </ModalButton>
  );
}
