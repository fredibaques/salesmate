"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button, EmptyState } from "@/components/ui";

/** Something failed while showing a page: say so and offer to try again, keeping the menu. */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<TriangleAlert />}
      title="Esta pantalla no se ha podido cargar"
      description={`Puede ser un fallo puntual de conexión. Si se repite, avísanos${error.digest ? ` con este código: ${error.digest}` : ""}.`}
      action={
        <Button onClick={() => retry()}>
          <RotateCw className="size-4" />
          Volver a probar
        </Button>
      }
    />
  );
}
