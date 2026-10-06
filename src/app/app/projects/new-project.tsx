import { Plus } from "lucide-react";
import { LinkButton, type ButtonSize, type ButtonVariant } from "@/components/ui";

export const PROJECT_HELP =
  "Un proyecto es una empresa, una marca o tu actividad como autónomo. Cada uno tiene su oferta, sus herramientas, su conocimiento y sus reglas, aislados del resto.";

/** «Nuevo proyecto»: opens the step-by-step creation. */
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
    <LinkButton
      href="/app/projects/new"
      variant={variant}
      size={size}
      iconOnly={iconOnly}
      aria-label={iconOnly ? label : undefined}
      className={className}
    >
      <Plus />
      {iconOnly ? null : label}
    </LinkButton>
  );
}
