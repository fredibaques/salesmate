"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTargets } from "@/app/app/connections/target-picker";
import { ActionForm } from "@/components/action-form";
import { IntegrationLogo } from "@/components/integration-logo";
import { ModalButton } from "@/components/modal";
import { Choice, cx, Field, Notice, Select } from "@/components/ui";
import { sendTableAction } from "../actions";

export type Destination = { id: string; label: string; provider: string };

const PLACE: Record<string, string> = {
  airtable: "Base de Airtable",
  trello: "Lista de Trello",
  monday: "Tablero de monday.com",
};
const LOGO: Record<string, string> = {
  google: "google_sheets",
  airtable: "airtable",
  trello: "trello",
  monday: "monday",
};

/**
 * «Exportar → a otra herramienta»: where (a Google Sheet, an Airtable base,
 * a Trello list, a monday board) and which rows. Opened from the Exportar
 * menu (?send=1).
 */
export function SendTableModal({
  baseId,
  destinations,
  pending,
  total,
}: {
  baseId: string;
  destinations: Destination[];
  pending: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [picked, setPicked] = useState(destinations[0]?.id ?? "");
  const destination = destinations.find((d) => d.id === picked);
  const needsPlace = Boolean(destination && PLACE[destination.provider]);
  const { targets, error } = useTargets(needsPlace ? picked : null);
  const [targetLabel, setTargetLabel] = useState("");

  return (
    <ModalButton
      label="Exportar a otra herramienta"
      title="Exportar a otra herramienta"
      hideTrigger
      defaultOpen
      width="lg"
      onClose={() => router.replace(pathname, { scroll: false })}
    >
      {destinations.length === 0 ? (
        <Notice>
          Conecta Google Sheets, Airtable, Trello o monday.com en Integraciones para exportar allí tus tablas.
        </Notice>
      ) : (
        <ActionForm action={sendTableAction.bind(null, baseId)} submitLabel="Exportar" className="space-y-5">
          <Field label="A dónde" group>
            <div className="grid gap-2 sm:grid-cols-2">
              {destinations.map((d) => (
                <label
                  key={d.id}
                  className={cx(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition hover:border-border-strong",
                    picked === d.id ? "border-primary bg-brand-50" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="connectionId"
                    value={d.id}
                    checked={picked === d.id}
                    onChange={() => {
                      setPicked(d.id);
                      setTargetLabel("");
                    }}
                    className="sr-only"
                  />
                  <IntegrationLogo id={LOGO[d.provider] ?? d.provider} name={d.label} size="sm" />
                  <span className="min-w-0 text-sm font-medium">{d.label}</span>
                </label>
              ))}
            </div>
          </Field>
          {destination?.provider === "google" ? (
            <p className="text-sm text-muted">
              Se crea una hoja de cálculo nueva en Google Drive con todas las columnas.
            </p>
          ) : null}
          {needsPlace ? (
            <Field label={PLACE[destination!.provider]}>
              {error ? (
                <p className="text-sm text-danger">{error}</p>
              ) : !targets ? (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 className="size-4 animate-spin" /> Cargando…
                </p>
              ) : (
                <>
                  <input type="hidden" name="targetLabel" value={targetLabel} />
                  <Select
                    name="target"
                    required
                    defaultValue=""
                    onChange={(e) => setTargetLabel(e.target.selectedOptions[0]?.textContent ?? "")}
                  >
                    <option value="" disabled>
                      Elige…
                    </option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </>
              )}
            </Field>
          ) : null}
          <Field label="Qué filas" group>
            <div className="space-y-2">
              <Choice
                type="radio"
                card
                name="include"
                value="pending"
                defaultChecked={pending > 0}
                label={`Las nuevas (${pending})`}
                description="Las que aún no se han exportado. Quedan marcadas como exportadas."
              />
              <Choice
                type="radio"
                card
                name="include"
                value="all"
                defaultChecked={pending === 0}
                label={`Todas (${total})`}
                description={
                  destination && ["trello", "monday"].includes(destination.provider)
                    ? "Una tarjeta o elemento por fila, hasta 100 por exportación."
                    : undefined
                }
              />
            </div>
          </Field>
        </ActionForm>
      )}
    </ModalButton>
  );
}
