"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui";

/** Copies a text (a link, a key) to the clipboard and says so for a moment. */
export function CopyButton({
  text,
  label = "Copiar",
  variant = "secondary",
  size = "sm",
}: {
  text: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass({ variant, size })}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copiado" : label}
    </button>
  );
}
