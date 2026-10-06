"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { Wizard, type WizardStep } from "@/components/wizard";
import { LANGUAGES, TIMEZONES, TONES } from "@/lib/profile-options";
import { createProjectAction } from "../actions";
import { CustomerFields, OfferFields, ProjectBasicsFields, VoiceFields } from "../profile-fields";

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[12rem_1fr]">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

const filled = (values: FormData, key: string) =>
  values
    .getAll(key)
    .map((v) => String(v).trim())
    .filter(Boolean);

export function ProjectWizard() {
  const steps: WizardStep[] = [
    {
      id: "project",
      title: "Proyecto",
      summary: "Una empresa, una marca o tu actividad como autónomo.",
      content: <ProjectBasicsFields />,
    },
    {
      id: "offer",
      title: "Qué vendes",
      summary: "Lo comparten todos los agentes del proyecto. Puedes completarlo después en Ajustes.",
      content: <OfferFields />,
    },
    {
      id: "customer",
      title: "Tu cliente",
      summary: "A quién vendes y qué problema le resuelves.",
      content: <CustomerFields />,
    },
    {
      id: "voice",
      title: "Cómo hablar",
      summary: "El tono con el que escriben los agentes y cómo responden a las dudas habituales.",
      content: <VoiceFields />,
    },
    {
      id: "review",
      title: "Revisar",
      summary: "Todo se puede cambiar después en Ajustes.",
      content: (values) => {
        const zone = TIMEZONES.find((t) => t.value === values.get("timezone"));
        const languages = LANGUAGES.filter((l) => values.getAll("languages").includes(l.value)).map(
          (l) => l.label,
        );
        const preset = values.get("tonePreset");
        const tone =
          preset === "custom" ? String(values.get("toneCustom") ?? "") : TONES[Number(preset)]?.label;
        const segments = filled(values, "segmentInclude");
        const objections = filled(values, "objection");
        return (
          <dl className="divide-y divide-border">
            <ReviewRow label="Nombre">{String(values.get("name") ?? "")}</ReviewRow>
            <ReviewRow label="Hora e idiomas">
              {[zone?.label ?? values.get("timezone"), languages.join(", ")].filter(Boolean).join(" · ")}
            </ReviewRow>
            <ReviewRow label="Qué vendes">
              {String(values.get("offer") ?? "") || <Badge tone="warning">Pendiente</Badge>}
            </ReviewRow>
            <ReviewRow label="A quién">
              {segments.length ? segments.join(", ") : <Badge tone="warning">Pendiente</Badge>}
            </ReviewRow>
            <ReviewRow label="Tono">{tone}</ReviewRow>
            <ReviewRow label="Objeciones">
              {objections.length ? `${objections.length} con su respuesta` : null}
            </ReviewRow>
          </dl>
        );
      },
    },
  ];
  return <Wizard steps={steps} action={createProjectAction} submitLabel="Crear proyecto" cancelHref="/app" />;
}
