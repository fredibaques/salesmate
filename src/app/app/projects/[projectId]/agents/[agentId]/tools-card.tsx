import { Globe, Plus, Wrench } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { IntegrationLogo } from "@/components/integration-logo";
import { ModalButton } from "@/components/modal";
import { Badge, CardGrid, Choice, EmptyState, EntityCard, IconTile, LinkButton } from "@/components/ui";
import { InfoTip } from "@/components/tooltip";
import { getIntegration } from "@/lib/integrations";
import type { AgentTools } from "@/server/db/schema";
import type { AgentToolKey, listDataSources, listMcpServers } from "@/server/services/agents";
import { addToolAction, removeToolAction, saveMcpToolsAction } from "../actions";

type Servers = Awaited<ReturnType<typeof listMcpServers>>;
type Sources = Awaited<ReturnType<typeof listDataSources>>;

const SOURCE_HELP: Record<string, string> = {
  apollo:
    "Busca empresas y personas por cargo, sector, zona y tamaño, y da sus datos de contacto profesionales. Buscar personas no gasta créditos; los datos de contacto y la búsqueda de empresas, sí.",
  hunter:
    "Encuentra a quién trabaja en una empresa (por su web) con su email de trabajo, busca el email de una persona concreta y lo verifica. Cada búsqueda y verificación gasta créditos.",
  lusha:
    "Da los datos de contacto profesionales de una persona o los de una empresa. Cada dato encontrado gasta créditos.",
};

const WEB_HELP =
  "Busca y lee páginas públicas (webs de empresas, directorios, noticias). Cada búsqueda cuesta alrededor de un céntimo.";

const MCP_HELP =
  "Las funciones que solo leen se usan directamente; las que cambian datos pasan por las reglas del proyecto y por tu aprobación.";

/** A tool the agent can be given: the web, a connected data provider or MCP server. */
type Available = {
  key: AgentToolKey;
  name: string;
  /** Integration whose logo it shows; the web has its own icon. */
  provider: string | null;
  kind: string;
  description: string;
  added: boolean;
  broken: boolean;
};

function logoOf(provider: string | null, size: "sm" | "md" = "md") {
  if (!provider) {
    return (
      <IconTile tone="accent" size={size === "sm" ? "title" : "md"}>
        <Globe />
      </IconTile>
    );
  }
  const integration = getIntegration(provider);
  return (
    <IntegrationLogo
      id={provider}
      name={integration?.name ?? provider}
      color={integration?.color}
      size={size}
    />
  );
}

/** Tools of the platform that aren't connected yet: offered with a link to connect them. */
const CONNECTABLE = ["serper", "apollo", "hunter", "lusha", "mcp"] as const;

function AvailableToolsButton({
  projectId,
  agentId,
  available,
  connectedProviders,
  variant = "secondary",
}: {
  projectId: string;
  agentId: string;
  available: Available[];
  connectedProviders: Set<string>;
  variant?: "primary" | "secondary";
}) {
  const notConnected = CONNECTABLE.filter((id) => id === "mcp" || !connectedProviders.has(id));
  return (
    <ModalButton
      label="Herramientas disponibles"
      icon={<Plus className="size-4" />}
      title="Herramientas disponibles"
      variant={variant}
      width="xl"
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Listas para usar</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((tool) => (
              <div
                key={tool.key}
                className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3"
              >
                {logoOf(tool.provider, "sm")}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {tool.name}
                    {tool.broken ? <Badge tone="danger">Con errores</Badge> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{tool.kind}</p>
                  <p className="mt-1 line-clamp-3 text-xs text-muted">{tool.description}</p>
                </div>
                <div className="shrink-0">
                  {tool.added ? (
                    <Badge tone="success">Añadida</Badge>
                  ) : (
                    <ActionForm
                      action={addToolAction.bind(null, projectId, agentId, tool.key, tool.name)}
                      submitLabel="Añadir"
                      submitVariant="secondary"
                      cancel={false}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Por conectar</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {notConnected.map((id) => {
              const integration = getIntegration(id);
              return (
                <div
                  key={id}
                  className="flex items-start gap-3 rounded-xl border border-dashed border-border p-3"
                >
                  {logoOf(id, "sm")}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{integration?.name ?? id}</p>
                    <p className="mt-0.5 text-xs text-muted">{integration?.tagline}</p>
                  </div>
                  <LinkButton href={`/app/connections?add=${id}`} variant="ghost" size="sm">
                    Conectar
                  </LinkButton>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </ModalButton>
  );
}

function RemoveTool({
  projectId,
  agentId,
  toolKey,
  name,
}: {
  projectId: string;
  agentId: string;
  toolKey: AgentToolKey;
  name: string;
}) {
  return (
    <ActionForm
      action={removeToolAction.bind(null, projectId, agentId, toolKey, name)}
      submitLabel="Quitar"
      submitVariant="ghost"
      confirm={`¿Quitar ${name} de este agente?`}
    />
  );
}

/**
 * The tools this agent uses, as cards, and the ones it could use (in a
 * modal). The project's knowledge is always there and isn't listed.
 */
export function ToolsCard({
  projectId,
  agentId,
  tools,
  servers,
  sources = [],
  canEdit = true,
}: {
  projectId: string;
  agentId: string;
  tools: AgentTools;
  servers: Servers;
  /** B2B data providers (Apollo, Lusha, Hunter) of the organization. */
  sources?: Sources;
  canEdit?: boolean;
}) {
  const data = new Set(tools.data ?? []);
  const mcp = new Map((tools.mcp ?? []).map((m) => [m.connectionId, new Set(m.tools)]));
  const available: Available[] = [
    {
      key: "web",
      name: "Búsqueda en internet",
      provider: null,
      kind: "Incluida",
      description: WEB_HELP,
      added: Boolean(tools.web),
      broken: false,
    },
    ...sources.map((s) => ({
      key: `data:${s.id}` as const,
      name: s.label,
      provider: s.provider,
      kind: `${getIntegration(s.provider)?.name ?? s.provider} · datos de empresas y contactos`,
      description: SOURCE_HELP[s.provider] ?? "",
      added: data.has(s.id),
      broken: s.status !== "active",
    })),
    ...servers.map((s) => ({
      key: `mcp:${s.id}` as const,
      name: s.label,
      provider: "mcp",
      kind: `Servidor MCP · ${s.tools.length} ${s.tools.length === 1 ? "función" : "funciones"}`,
      description: MCP_HELP,
      added: mcp.has(s.id),
      broken: s.status !== "active",
    })),
  ];
  const picker = (variant?: "primary" | "secondary") => (
    <AvailableToolsButton
      projectId={projectId}
      agentId={agentId}
      available={available}
      connectedProviders={new Set(sources.map((s) => s.provider))}
      variant={variant}
    />
  );
  const inUse = available.filter((t) => t.added);
  const status = (broken: boolean) =>
    broken ? <Badge tone="danger">Con errores</Badge> : <Badge tone="success">En uso</Badge>;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          Herramientas
          <InfoTip>
            Además del conocimiento del proyecto, que siempre puede consultar. Lo que solo lee se usa
            directamente; lo que cambia algo fuera pasa por las reglas del proyecto y por tu aprobación según
            su autonomía.
          </InfoTip>
        </h2>
        {canEdit && inUse.length > 0 ? picker() : null}
      </div>

      {inUse.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title="Este agente aún no usa herramientas"
          description="Dale acceso a internet, a proveedores de datos como Apollo o Hunter, o a las herramientas que conectes por MCP. Solo trabaja con lo que añadas aquí y con el conocimiento del proyecto."
          action={canEdit ? picker("primary") : null}
        />
      ) : (
        <CardGrid className="xl:grid-cols-2">
          {inUse.map((tool) => {
            const footer = canEdit ? (
              <RemoveTool projectId={projectId} agentId={agentId} toolKey={tool.key} name={tool.name} />
            ) : null;
            if (!tool.key.startsWith("mcp:")) {
              return (
                <EntityCard
                  key={tool.key}
                  media={logoOf(tool.provider)}
                  title={tool.name}
                  meta={tool.kind}
                  badge={status(tool.broken)}
                  description={tool.description}
                  footer={footer}
                />
              );
            }
            const server = servers.find((s) => `mcp:${s.id}` === tool.key)!;
            const allowed = mcp.get(server.id) ?? new Set<string>();
            const enabled = server.tools.filter((t) => allowed.has(t.name));
            return (
              <EntityCard
                key={tool.key}
                media={logoOf(tool.provider)}
                title={tool.name}
                meta={`Servidor MCP · usa ${enabled.length} de ${server.tools.length} funciones`}
                badge={status(tool.broken)}
                footer={
                  canEdit ? (
                    <>
                      <ModalButton
                        label="Elegir funciones"
                        title={`Funciones de ${server.label}`}
                        variant="secondary"
                        width="lg"
                      >
                        <ActionForm
                          action={saveMcpToolsAction.bind(null, projectId, agentId, server.id)}
                          submitLabel="Guardar"
                          className="space-y-4"
                        >
                          <ul className="space-y-2">
                            {server.tools.map((t) => (
                              <li key={t.name}>
                                <Choice
                                  name="tool"
                                  value={t.name}
                                  defaultChecked={allowed.has(t.name)}
                                  label={
                                    <span className="flex flex-wrap items-center gap-2">
                                      <code className="text-xs">{t.name}</code>
                                      {t.readOnly ? (
                                        <Badge>Solo lectura</Badge>
                                      ) : (
                                        <Badge tone="warning">Cambia datos · pasa por aprobación</Badge>
                                      )}
                                    </span>
                                  }
                                  description={t.description}
                                />
                              </li>
                            ))}
                          </ul>
                        </ActionForm>
                      </ModalButton>
                      {footer}
                    </>
                  ) : null
                }
              >
                <div className="flex flex-wrap gap-1.5">
                  {enabled.slice(0, 8).map((t) => (
                    <code key={t.name} className="rounded-md bg-background px-1.5 py-0.5 text-xs">
                      {t.name}
                    </code>
                  ))}
                  {enabled.length > 8 ? (
                    <span className="text-xs text-muted">y {enabled.length - 8} más</span>
                  ) : null}
                </div>
              </EntityCard>
            );
          })}
        </CardGrid>
      )}
    </section>
  );
}
