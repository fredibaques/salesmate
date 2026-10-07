import { KeyRound, Sparkles } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Badge, Card, EmptyState, Notice } from "@/components/ui";
import { AI_PROVIDER_INFO, findModel } from "@/lib/ai-providers";
import { formatDateTime } from "@/lib/format";
import { requireTenant } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { aiUsageThisMonth, getOrgAi } from "@/server/llm/org-ai";
import { AiFields } from "./ai-form";
import { connectAi, disconnectAi } from "./actions";

export const metadata = { title: "IA" };

const usd = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function ConnectButton({
  current,
  variant = "primary",
}: {
  current?: Parameters<typeof AiFields>[0]["current"];
  variant?: "primary" | "secondary";
}) {
  return (
    <ModalButton
      label={current ? "Cambiar" : "Conectar IA"}
      icon={current ? <KeyRound /> : <Sparkles />}
      title={current ? "Cambiar la cuenta de IA" : "Conectar tu IA"}
      variant={variant}
    >
      <ActionForm action={connectAi} submitLabel={current ? "Guardar" : "Conectar"} className="space-y-4">
        <AiFields current={current} />
      </ActionForm>
    </ModalButton>
  );
}

export default async function AiSettingsPage() {
  const tenant = await requireTenant();
  const db = getDb();
  const [ai, usage] = await Promise.all([getOrgAi(db, tenant), aiUsageThisMonth(db, tenant)]);
  const canEdit = tenant.role === "owner" || tenant.role === "admin";

  if (!ai) {
    return (
      <Card>
        <EmptyState
          icon={<Sparkles />}
          title="Conecta tu IA"
          description="Los agentes, Copilot y las propuestas con IA usan la cuenta de tu organización: Anthropic, OpenAI o Kimi. Pagas directamente al proveedor lo que consumen. Hasta entonces, la IA está apagada."
          action={canEdit ? <ConnectButton /> : undefined}
        />
      </Card>
    );
  }

  const info = AI_PROVIDER_INFO[ai.provider];
  const model = findModel(ai.model);
  return (
    <div className="space-y-6">
      {ai.status === "error" ? (
        <Notice tone="danger">
          {ai.lastError} La IA no funcionará hasta que lo resuelvas
          {ai.errorKind === "credit" ? " recargando saldo en la consola del proveedor" : ""}.
          {ai.lastErrorAt ? ` (${formatDateTime(ai.lastErrorAt)})` : null}
        </Notice>
      ) : null}

      <Card
        title="Cuenta de IA"
        tip="Todo lo que hace la IA en tu organización (agentes, Copilot, propuestas) se hace con esta cuenta y se cobra en ella. La búsqueda web de los agentes también."
        actions={
          canEdit ? (
            <>
              <ConnectButton
                variant="secondary"
                current={{ provider: ai.provider, model: ai.model, keyHint: ai.keyHint }}
              />
              <ActionForm
                action={disconnectAi}
                submitLabel="Desconectar"
                submitVariant="dangerGhost"
                confirm="¿Desconectar la IA? Los agentes y Copilot dejarán de funcionar hasta que conectes otra cuenta."
              />
            </>
          ) : null
        }
      >
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">Proveedor</dt>
          <dd className="flex flex-wrap items-center gap-3">
            <span className="font-medium">{info.label}</span>
            <Badge tone={ai.status === "active" ? "success" : "danger"}>
              {ai.status === "active" ? "Conectada" : "Con errores"}
            </Badge>
          </dd>
          <dt className="text-muted">Modelo</dt>
          <dd>
            {model?.label ?? ai.model}
            {model ? <span className="text-muted"> · {model.hint}</span> : null}
          </dd>
          <dt className="text-muted">Clave</dt>
          <dd className="font-mono">····{ai.keyHint}</dd>
          <dt className="text-muted">Actualizada</dt>
          <dd>{formatDateTime(ai.updatedAt)}</dd>
        </dl>
      </Card>

      <Card
        title="Uso este mes"
        tip="Estimación con los precios públicos del proveedor, incluida la búsqueda web. Tu factura real está en la consola del proveedor."
      >
        <p className="text-sm">
          <span className="font-display text-2xl font-semibold tabular-nums">
            {usd.format(usage.costUsd)}
          </span>
          <span className="text-muted">
            {" "}
            · {usage.runs} {usage.runs === 1 ? "ejecución" : "ejecuciones"} de los agentes y Copilot
          </span>
        </p>
      </Card>
    </div>
  );
}
