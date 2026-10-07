"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ModalScope } from "./modal";
import { buttonClass, cx, IconTile } from "./ui";

/**
 * A panel that slides over the right side of the page to show and edit one
 * record (a row of a prospect base) without leaving the list. It lives in
 * the URL: the page renders it while a parameter is set, and closing it
 * goes back to `closeHref`. Forms inside close it after saving.
 */
export function Drawer({
  title,
  subtitle,
  icon,
  closeHref,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  closeHref: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const close = useCallback(() => router.push(closeHref, { scroll: false }), [router, closeHref]);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      // Esc closes the dialog natively; keep the URL in step.
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
      className="m-0 ml-auto h-dvh max-h-none w-full max-w-xl overflow-hidden border-0 border-l border-border bg-surface p-0 text-left text-foreground shadow-xl"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-3 border-b border-border px-6 py-4">
          {icon ? <IconTile>{icon}</IconTile> : null}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{title}</h2>
            {subtitle ? <div className="mt-0.5 text-xs text-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Cerrar"
            className={cx(buttonClass({ variant: "ghost", size: "sm", iconOnly: true }), "-mr-2 text-muted")}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ModalScope close={close}>{children}</ModalScope>
        </div>
      </div>
    </dialog>
  );
}
