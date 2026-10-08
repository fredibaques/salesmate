"use client";

import { Plus } from "lucide-react";
import { ModalButton } from "@/components/modal";
import type { ButtonSize, ButtonVariant } from "@/components/ui";
import { ProjectWizard } from "./new/project-wizard";

/** «Nuevo proyecto»: the step-by-step creation, in a modal. */
export function NewProjectButton({
  variant = "primary",
  size,
  iconOnly,
  className,
  label = "Nuevo proyecto",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <ModalButton
      label={label}
      icon={<Plus className="size-4" />}
      title="Nuevo proyecto"
      variant={variant}
      size={size}
      iconOnly={iconOnly}
      width="xl"
      className={className}
    >
      <ProjectWizard />
    </ModalButton>
  );
}
