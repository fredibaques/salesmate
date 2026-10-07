"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormAction } from "@/components/action-form";
import { Choice, Field, Notice, Select, buttonClass } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";
import { Wizard } from "@/components/wizard";
import { AI_GUIDES } from "@/lib/ai-guides";
import { AI_PROVIDER_INFO, AI_PROVIDERS, isAiProvider, type AiProvider } from "@/lib/ai-providers";

export const AI_GUIDE_HREF = "/app/ai/connect";

type Current = { provider: AiProvider; model: string; keyHint: string };

function priceLine(provider: AiProvider) {
  const m = AI_PROVIDER_INFO[provider].models[0];
  return `Recomendado: ${m.label} · ${m.price.input} $ entrada / ${m.price.output} $ salida por millón de tokens`;
}

function ProviderChoices({
  value,
  onChange,
  withSummary = false,
}: {
  value?: AiProvider;
  onChange?: (provider: AiProvider) => void;
  withSummary?: boolean;
}) {
  return (
    <div className="grid gap-2">
      {AI_PROVIDERS.map((id) => (
        <Choice
          key={id}
          type="radio"
          card
          required
          name="provider"
          value={id}
          {...(onChange
            ? { checked: value === id, onChange: () => onChange(id) }
            : { defaultChecked: value === id })}
          label={AI_PROVIDER_INFO[id].label}
          description={
            withSummary ? (
              <>
                {AI_GUIDES[id].summary}
                <br />
                {priceLine(id)}
              </>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}

function ModelField({ provider, defaultModel }: { provider: AiProvider; defaultModel?: string }) {
  const models = AI_PROVIDER_INFO[provider].models;
  return (
    <Field
      label="Modelo"
      tip="Lo usan todos los agentes, Copilot y las propuestas con IA. Puedes cambiarlo cuando quieras."
    >
      <Select
        key={provider}
        name="model"
        defaultValue={models.some((m) => m.id === defaultModel) ? defaultModel : models[0].id}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.hint}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function KeyField({
  provider,
  keepHint,
  guideLink = true,
}: {
  provider: AiProvider;
  keepHint?: string;
  /** Off inside the wizard, which already shows the guide. */
  guideLink?: boolean;
}) {
  const info = AI_PROVIDER_INFO[provider];
  return (
    <Field
      label="Clave de API"
      optional={Boolean(keepHint)}
      hint={
        <>
          {keepHint ? `Déjala vacía para mantener la actual (····${keepHint}). ` : null}
          {guideLink ? (
            <>
              ¿No la tienes?{" "}
              <Link
                href={`${AI_GUIDE_HREF}?provider=${provider}`}
                className="text-accent underline-offset-2 hover:underline"
              >
                Guía paso a paso
              </Link>
            </>
          ) : (
            `Empieza por ${info.keyPlaceholder.replace("…", "")}`
          )}
        </>
      }
      tip="Se comprueba con el proveedor sin gastar nada y se guarda cifrada. Nadie puede volver a verla: solo sus últimos caracteres."
    >
      <PasswordInput
        key={provider}
        name="apiKey"
        required={!keepHint}
        autoComplete="off"
        spellCheck={false}
        placeholder={info.keyPlaceholder}
      />
    </Field>
  );
}

/** Provider, model and key in one go, for changing an account already connected. */
export function AiFields({ current }: { current?: Current }) {
  const [provider, setProvider] = useState<AiProvider>(current?.provider ?? "anthropic");
  const same = current?.provider === provider;
  return (
    <>
      <Field label="Proveedor" group>
        <ProviderChoices value={provider} onChange={setProvider} />
      </Field>
      <ModelField provider={provider} defaultModel={same ? current.model : undefined} />
      <KeyField provider={provider} keepHint={same ? current.keyHint : undefined} />
    </>
  );
}

/** The provider's console steps to get a key that works, with links to each page. */
export function KeyGuide({ provider }: { provider: AiProvider }) {
  const guide = AI_GUIDES[provider];
  return (
    <>
      <ol className="space-y-4">
        {guide.steps.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
              <p className="text-sm font-medium">{step.title}</p>
              {step.detail ? <p className="text-sm text-muted">{step.detail}</p> : null}
              {step.link ? (
                <a
                  href={step.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {step.link.label}
                  <ExternalLink />
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <Notice tone="warning">
        <ul className="list-disc space-y-1 pl-4">
          {guide.watchOut.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      </Notice>
    </>
  );
}

/** First connection: choose a provider, follow its guide to get the key, then paste it. */
export function ConnectAiWizard({
  action,
  initialProvider,
  current,
}: {
  action: FormAction;
  initialProvider?: AiProvider;
  current?: Current;
}) {
  const providerOf = (values: FormData) => {
    const p = values.get("provider");
    return isAiProvider(p) ? p : "anthropic";
  };
  return (
    <Wizard
      action={action}
      submitLabel="Conectar"
      cancelHref="/app/ai"
      steps={[
        {
          id: "provider",
          title: "Elige proveedor",
          summary: "Pagas directamente al proveedor lo que consumen tus agentes.",
          content: <ProviderChoices value={initialProvider ?? current?.provider} withSummary />,
        },
        {
          id: "key",
          title: "Consigue la clave",
          summary: "Hazlo en otra pestaña y vuelve aquí con la clave copiada.",
          content: (values) => <KeyGuide provider={providerOf(values)} />,
        },
        {
          id: "connect",
          title: "Pégala y elige modelo",
          summary: "La comprobamos con el proveedor antes de guardarla, sin coste.",
          content: (values) => {
            const provider = providerOf(values);
            const same = current?.provider === provider;
            return (
              <>
                <KeyField
                  provider={provider}
                  keepHint={same ? current.keyHint : undefined}
                  guideLink={false}
                />
                <ModelField provider={provider} defaultModel={same ? current.model : undefined} />
              </>
            );
          },
        },
      ]}
    />
  );
}
