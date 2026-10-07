"use client";

import { useEffect, useRef, useState } from "react";
import { Choice, Field, Select } from "@/components/form-controls";
import { PasswordInput } from "@/components/password-input";
import { AI_PROVIDER_INFO, AI_PROVIDERS, type AiProvider } from "@/lib/ai-providers";

/** Provider, model and key. The models follow the chosen provider. */
export function AiFields({
  current,
}: {
  current?: { provider: AiProvider; model: string; keyHint: string };
}) {
  const [provider, setProvider] = useState<AiProvider>(current?.provider ?? "anthropic");
  const [model, setModel] = useState<string | undefined>(current?.model);
  const [apiKey, setApiKey] = useState("");
  // React resets the form after every submit, failed ones included: remount
  // the fields from state so a second try keeps what was chosen and typed.
  const [round, setRound] = useState(0);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    if (!form) return;
    const onReset = () => setRound((r) => r + 1);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const info = AI_PROVIDER_INFO[provider];
  const keepsKey = current?.provider === provider;
  const chosenModel = info.models.some((m) => m.id === model) ? model : info.models[0].id;
  return (
    <div key={round} className="space-y-4">
      <span ref={anchor} hidden />
      <Field label="Proveedor" group>
        <div className="grid gap-2">
          {AI_PROVIDERS.map((id) => (
            <Choice
              key={id}
              type="radio"
              card
              name="provider"
              value={id}
              defaultChecked={provider === id}
              onChange={() => {
                setProvider(id);
                setApiKey("");
              }}
              label={AI_PROVIDER_INFO[id].label}
            />
          ))}
        </div>
      </Field>
      <Field
        label="Modelo"
        tip="Lo usan todos los agentes, Copilot y las propuestas con IA. Puedes cambiarlo cuando quieras."
      >
        <Select
          key={provider}
          name="model"
          defaultValue={chosenModel}
          onChange={(e) => setModel(e.target.value)}
        >
          {info.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label} — {m.hint}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Clave de API"
        optional={keepsKey}
        hint={
          <>
            Créala en{" "}
            <a
              href={info.keysUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              la consola de {info.label}
            </a>
            .{keepsKey ? ` Déjala vacía para mantener la actual (····${current.keyHint}).` : null}
          </>
        }
        tip="Se comprueba con el proveedor sin gastar nada y se guarda cifrada. Nadie puede volver a verla: solo sus últimos caracteres."
      >
        <PasswordInput
          key={provider}
          name="apiKey"
          required={!keepsKey}
          autoComplete="off"
          spellCheck={false}
          placeholder={info.keyPlaceholder}
          defaultValue={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Field>
    </div>
  );
}
