"use client";

import { useState } from "react";
import { ColorField } from "@/components/agent-look-fields";
import { ListInput, PairListInput } from "@/components/list-input";
import { Chip, ChipSelect, Choice, Field, Input, Select, Textarea } from "@/components/ui";
import { DECISION_MAKERS, GEOGRAPHIES, LANGUAGES, TIMEZONES, TONES } from "@/lib/profile-options";
import type { BusinessProfile, ProjectAudience } from "@/server/playbooks/spec";

/**
 * The fields of a project (its data, goal and audience) and of the business
 * profile («Tu negocio»: offer, customer, voice), in groups. The creation
 * wizard shows one group per step; the settings pages show them together.
 */

export type ProjectBasics = {
  name: string;
  timezone: string;
  languages: string[];
  color?: string | null;
};

export function ProjectBasicsFields({ project }: { project?: ProjectBasics }) {
  const timezone = project?.timezone ?? "Europe/Madrid";
  const languages = project?.languages ?? ["es"];
  const zones = TIMEZONES.some((t) => t.value === timezone)
    ? TIMEZONES
    : [...TIMEZONES, { value: timezone, label: timezone }];
  return (
    <>
      <Field label="Nombre">
        <Input name="name" required minLength={2} defaultValue={project?.name} placeholder="p. ej. Swipoo" />
      </Field>
      <ColorField label="Color del proyecto" color={project?.color} />
      <Field label="Zona horaria" tip="Los horarios de los agentes y de contacto se cuentan en esta hora.">
        <Select name="timezone" defaultValue={timezone}>
          {zones.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Idiomas"
        tip="En los que los agentes pueden escribir. Responden en el idioma del contacto."
        group
      >
        <div className="flex flex-wrap gap-1.5">
          {LANGUAGES.map((l) => (
            <Chip key={l.value} name="languages" value={l.value} defaultChecked={languages.includes(l.value)}>
              {l.label}
            </Chip>
          ))}
        </div>
      </Field>
    </>
  );
}

/** What the project is for and who it's for: the only things that change from one project to another. */
export function GoalFields({
  goal,
  audience,
  business,
}: {
  goal?: string | null;
  audience?: ProjectAudience;
  /** The business's ideal customer, used when the project doesn't narrow it. */
  business?: BusinessProfile | null;
}) {
  const inherited = business?.segment.include.length ? business.segment.include.join(", ") : null;
  return (
    <>
      <Field
        label="Qué quieres conseguir"
        tip="El objetivo del proyecto, con el siguiente paso que buscas: reuniones, llamadas, presupuestos… Los agentes trabajan para conseguirlo."
      >
        <Textarea
          name="description"
          required
          defaultValue={goal ?? ""}
          placeholder="p. ej. Conseguir 20 reuniones con concesionarios de Andalucía para presentarles el servicio de transferencias"
        />
      </Field>
      <Field
        label="A quién va dirigido"
        optional
        group
        hint={inherited ? `Si lo dejas vacío: ${inherited} (de Tu negocio).` : undefined}
        tip="Acota el cliente ideal de tu negocio para este proyecto."
      >
        <ListInput
          name="audienceInclude"
          defaultValue={audience?.segment.include}
          placeholder="p. ej. Concesionarios multimarca"
        />
      </Field>
      <Field label="A quién no" optional group>
        <ListInput
          name="audienceExclude"
          defaultValue={audience?.segment.exclude}
          placeholder="p. ej. Concesionarios oficiales de una marca"
        />
      </Field>
      <Field label="Zonas" optional group>
        <ChipSelect name="geography" options={GEOGRAPHIES} defaultValue={audience?.segment.geography} />
      </Field>
    </>
  );
}

export function OfferFields({ profile }: { profile?: BusinessProfile | null }) {
  return (
    <>
      <Field label="Web" optional>
        <Input name="website" type="url" defaultValue={profile?.website ?? ""} placeholder="https://" />
      </Field>
      <Field label="Qué vendes" tip="Qué vendes y para qué sirve, en una o dos frases.">
        <Textarea
          name="offer"
          defaultValue={profile?.offer}
          placeholder="p. ej. Gestionamos las transferencias de vehículos de concesionarios en 24 horas"
        />
      </Field>
      <Field label="Por qué te eligen" tip="Tu propuesta de valor frente a otras opciones.">
        <Textarea name="valueProposition" defaultValue={profile?.valueProposition} />
      </Field>
    </>
  );
}

export function CustomerFields({ profile }: { profile?: BusinessProfile | null }) {
  return (
    <>
      <Field label="A quién te diriges" group>
        <ListInput
          name="segmentInclude"
          defaultValue={profile?.segment.include}
          placeholder="p. ej. Concesionarios multimarca"
        />
      </Field>
      <Field label="A quién no" optional group>
        <ListInput
          name="segmentExclude"
          defaultValue={profile?.segment.exclude}
          placeholder="p. ej. Particulares"
        />
      </Field>
      <Field label="Quién decide la compra" group>
        <ChipSelect name="decisionMakers" options={DECISION_MAKERS} defaultValue={profile?.decisionMakers} />
      </Field>
      <Field label="Problemas que resuelves" group>
        <ListInput
          name="pains"
          defaultValue={profile?.pains}
          placeholder="p. ej. Pierden días con el papeleo"
        />
      </Field>
    </>
  );
}

function ToneField({ tone }: { tone?: string }) {
  const preset = TONES.findIndex((t) => t.text === tone);
  const [choice, setChoice] = useState(preset >= 0 ? String(preset) : tone ? "custom" : "0");
  return (
    <Field label="Tono" group>
      <div className="grid gap-2">
        {TONES.map((t, i) => (
          <Choice
            key={t.label}
            card
            type="radio"
            name="tonePreset"
            value={String(i)}
            checked={choice === String(i)}
            onChange={() => setChoice(String(i))}
            label={t.label}
            description={t.text}
          />
        ))}
        <Choice
          card
          type="radio"
          name="tonePreset"
          value="custom"
          checked={choice === "custom"}
          onChange={() => setChoice("custom")}
          label="Personalizado"
          description="Descríbelo con tus palabras."
        />
        {choice === "custom" ? (
          <Textarea
            name="toneCustom"
            required
            defaultValue={preset < 0 ? tone : ""}
            placeholder="p. ej. Cercano, con humor y sin tecnicismos"
            aria-label="Tono personalizado"
          />
        ) : null}
      </div>
    </Field>
  );
}

export function VoiceFields({ profile }: { profile?: BusinessProfile | null }) {
  return (
    <>
      <ToneField tone={profile?.tone} />
      <Field label="Firma de los emails" optional>
        <Textarea name="signature" defaultValue={profile?.signature} placeholder={"Ana García\nSwipoo"} />
      </Field>
      <Field
        label="Objeciones frecuentes"
        tip="Lo que suelen decir para no comprar y cómo respondes. Los agentes lo usan tal cual."
        optional
        group
      >
        <PairListInput
          names={["objection", "objectionResponse"]}
          labels={["Objeción", "Cómo responder"]}
          defaultValue={profile?.objections.map((o) => [o.objection, o.response] as [string, string])}
          placeholders={[
            "p. ej. Es caro",
            "Cómo respondes, p. ej. explicamos el ahorro de tiempo por operación",
          ]}
          addLabel="Añadir objeción"
        />
      </Field>
    </>
  );
}
