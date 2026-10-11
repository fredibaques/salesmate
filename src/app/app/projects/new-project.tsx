import { Plus } from "lucide-react";
import { cache } from "react";
import { ModalButton } from "@/components/modal";
import type { ButtonSize, ButtonVariant } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getBusinessProfile } from "@/server/services/business";
import { ProjectWizard } from "./new/project-wizard";

/** Whether the business is described decides the wizard's steps; asked once per request. */
export const currentBusiness = cache(async () => getBusinessProfile(getDb(), await requireTenant()));

/** «Nuevo proyecto»: the step-by-step creation, in a modal. */
export async function NewProjectButton({
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
      <ProjectWizard business={await currentBusiness()} />
    </ModalButton>
  );
}
