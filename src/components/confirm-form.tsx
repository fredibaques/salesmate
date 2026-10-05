"use client";

import type { ReactNode } from "react";

/** A form that asks before submitting, for actions that remove things. */
export function ConfirmForm({
  action,
  message,
  children,
}: {
  action: () => Promise<void>;
  message: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}
