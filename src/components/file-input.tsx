"use client";

import type { ComponentProps } from "react";
import { Input } from "./form-controls";

/**
 * A file field that refuses files over `maxMb` as soon as one is chosen,
 * before anything is sent (the host would reject the request anyway).
 */
export function FileInput({ maxMb, onChange, ...props }: ComponentProps<typeof Input> & { maxMb: number }) {
  return (
    <Input
      {...props}
      type="file"
      onChange={(e) => {
        const input = e.currentTarget;
        const big = [...(input.files ?? [])].find((f) => f.size > maxMb * 1024 * 1024);
        input.setCustomValidity(
          big
            ? `«${big.name}» ocupa ${(big.size / 1024 / 1024).toFixed(1)} MB: el máximo es ${maxMb} MB. Si es un PDF, prueba a comprimirlo o divídelo en partes.`
            : "",
        );
        if (big) input.reportValidity();
        onChange?.(e);
      }}
    />
  );
}
