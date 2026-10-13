"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { Wizard, type WizardStep } from "@/components/wizard";
import { LANGUAGES, TIMEZONES, TONES } from "@/lib/profile-options";
import { createProjectAction } from "../actions";
import type { BusinessProfile } from "@/server/playbooks/spec";
import { CustomerFields, GoalFields, OfferFields, ProjectBasicsFields, VoiceFields } from "../profile-fields";

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

/**
 * Creating a project asks for its data, its goal and who it's for. The first
 * time (the business isn't described yet) it also asks for «Tu negocio»:
 * what you sell, your customer and how to talk, shared by every project.
 */
export function ProjectWizard({ business }: { business: BusinessProfile | null }) {
  const describe = !business?.offer;
  const steps: WizardStep[] = [
    {
      id: "project",
      title: "Proyecto",
      content: <ProjectBasicsFields />,
    },
    ...(describe
      ? [
          {
            id: "offer",
            title: "Tu negocio",
            summary:
              "Solo esta vez: lo comparten todos tus proyectos. Puedes cambiarlo en Ajustes › Tu negocio.",
            content: (
              <>
                <input type="hidden" name="withBusiness" value="1" />
                <OfferFields />
              </>
            ),
          },
          {
            id: "customer",
            title: "Tu cliente",
            summary: "A quién vendes y qué problema le resuelves, en general.",
            content: <CustomerFields />,
          },
          {
            id: "voice",
            title: "Cómo hablar",
            summary: "El tono con el que escriben los agentes y cómo responden a las dudas habituales.",
            content: <VoiceFields />,
          },
        ]
      : []),
    {
      id: "goal",
      title: "Objetivo",
      summary: "Qué quieres conseguir con este proyecto y, si quieres, a quién va dirigido.",
      content: <GoalFields business={business} />,
    },
    {
      id: "review",
      title: "Revisar",
      summary: "Todo se puede cambiar después.",
      content: (values) => {
        const zone = TIMEZONES.find((t) => t.value === values.get("timezone"));
        const languages = LANGUAGES.filter((l) => values.getAll("languages").includes(l.value)).map(
          (l) => l.label,
        );
        const audience = filled(values, "audienceInclude");
        const zones = values.getAll("geography").map(String).filter(Boolean);
        const preset = values.get("tonePreset");
        const tone =
          preset === "custom" ? String(values.get("toneCustom") ?? "") : TONES[Number(preset)]?.label;
        const objections = filled(values, "objection");
        return (
          <dl className="divide-y divide-border">
            <ReviewRow label="Nombre">{String(values.get("name") ?? "")}</ReviewRow>
            <ReviewRow label="Hora e idiomas">
              {[zone?.label ?? values.get("timezone"), languages.join(", ")].filter(Boolean).join(" · ")}
            </ReviewRow>
            <ReviewRow label="Objetivo">{String(values.get("description") ?? "")}</ReviewRow>
            <ReviewRow label="A quién">
              {audience.length ? audience.join(", ") : "El cliente de tu negocio"}
            </ReviewRow>
            <ReviewRow label="Zonas">{zones.join(", ")}</ReviewRow>
            {describe ? (
              <>
                <ReviewRow label="Qué vendes">
                  {String(values.get("offer") ?? "") || <Badge tone="warning">Pendiente</Badge>}
                </ReviewRow>
                <ReviewRow label="Tono">{tone}</ReviewRow>
                <ReviewRow label="Objeciones">
                  {objections.length ? `${objections.length} con su respuesta` : null}
                </ReviewRow>
              </>
            ) : null}
          </dl>
        );
      },
    },
  ];
  return <Wizard steps={steps} action={createProjectAction} submitLabel="Crear proyecto" cancelHref="/app" />;
}
