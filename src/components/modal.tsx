"use client";

import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./ui";

type ModalApi = { close: () => void };

const ModalContext = createContext<ModalApi | null>(null);

/** The enclosing modal, if any. Forms use it to close themselves after saving. */
export function useModal() {
  return useContext(ModalContext);
}

/**
 * A button that opens its content in a modal. Creation forms live here instead
 * of sitting open on the page. The content mounts only while open, so every
 * opening starts with a clean form.
 */
export function ModalButton({
  label,
  icon,
  title,
  children,
  variant = "primary",
  size = "md",
  iconOnly = false,
  width = "md",
  className,
}: {
  label: ReactNode;
  icon?: ReactNode;
  title: string;
  children: ReactNode;
  variant?: ButtonVariant;
  /** Size of the button that opens the modal. */
  size?: ButtonSize;
  /** Show only the icon; `label` (a string) becomes its accessible name. */
  iconOnly?: boolean;
  /** Width of the modal. */
  width?: "md" | "lg";
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => dialog.current?.close(), []);
  const pathname = usePathname();

  // A form that redirects (e.g. creating a project) navigates away: close behind it.
  useEffect(() => close(), [pathname, close]);

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={iconOnly && typeof label === "string" ? label : undefined}
        className={cx(buttonClass({ variant, size, iconOnly }), className)}
      >
        {icon}
        {iconOnly ? null : label}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        className={cx(
          "m-auto max-h-[90vh] w-[calc(100%-2rem)] overflow-hidden rounded-2xl border border-border bg-surface p-0 text-left font-normal text-foreground shadow-2xl",
          width === "lg" ? "max-w-2xl" : "max-w-lg",
        )}
      >
        {open ? (
          <div className="flex max-h-[90vh] flex-col">
            <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
              <h2 className="text-base font-semibold">{title}</h2>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar"
                className={cx(
                  buttonClass({ variant: "ghost", size: "sm", iconOnly: true }),
                  "-mr-2 text-muted",
                )}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-5">
              <ModalContext.Provider value={{ close }}>{children}</ModalContext.Provider>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
