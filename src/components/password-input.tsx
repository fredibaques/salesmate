"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { cx } from "./cx";
import { controlClass, type ControlLook } from "./form-controls";

/** Password field with a button to show what was typed. */
export function PasswordInput({
  size,
  invalid,
  className,
  ...props
}: Omit<ComponentProps<"input">, "size" | "type"> & ControlLook) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={cx("relative h-fit", className)}>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
        <Lock className="size-4" />
      </span>
      <input
        {...props}
        type={visible ? "text" : "password"}
        className={cx(controlClass({ size, invalid }), "px-9")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        className="absolute inset-y-0 right-1.5 my-auto flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}
