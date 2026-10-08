import { Plug, Plus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Choice, EmptyState, LinkButton } from "@/components/ui";
import type { AgentTools } from "@/server/db/schema";
import type { listDataSources, listMcpServers, ProjectAgentType } from "@/server/services/agents";
import { saveTools } from "../actions";

type Servers = Awaited<ReturnType<typeof listMcpServers>>;
type Sources = Awaited<ReturnType<typeof listDataSources>>;

const SOURCE_HELP: Record<string, string> = {
  apollo:
    "Busca empresas y personas por cargo, sector, zona y tamaño, y da sus datos de contacto profesionales. Buscar personas no gasta créditos; los datos de contacto y la búsqueda de empresas, sí.",
  lusha:
    "Da los datos de contacto profesionales de una persona o los de una empresa. Cada dato encontrado gasta créditos.",
};

/** Which tools this agent may use: the web and the tools of the organization's MCP servers. */
export function ToolsCard({
  projectId,
  agentType,
  tools,
  servers,
  sources = [],
}: {
  projectId: string;
  agentType: ProjectAgentType;
  tools: AgentTools;
  servers: Servers;
  /** B2B data providers (Apollo, Lusha) of the organization. */
  sources?: Sources;
}) {
  const data = new Set(tools.data ?? []);
  const allowed = new Set((tools.mcp ?? []).flatMap((m) => m.tools.map((t) => `${m.connectionId}::${t}`)));
  return (
    <Card
      title="Herramientas"
      tip="Además del conocimiento del proyecto, que siempre puede consultar. Lo que solo lee se usa directamente; lo que cambia algo fuera pasa por las reglas del proyecto y por tu aprobación según su autonomía."
    >
      <ActionForm
        key={JSON.stringify(tools)}
        action={saveTools.bind(null, projectId, agentType)}
        submitLabel="Guardar herramientas"
        className="space-y-5"
      >
        <Choice
          card
          name="web"
          defaultChecked={Boolean(tools.web)}
          label="Búsqueda en internet"
          description="Busca y lee páginas públicas (webs de empresas, directorios, noticias). Cada búsqueda cuesta alrededor de un céntimo."
        />

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Datos de empresas y contactos</h3>
          {sources.length === 0 ? (
            <EmptyState
              compact
              icon={<Plug />}
              title="No hay Apollo ni Lusha conectados"
              description="Con ellos el agente encuentra a la persona que decide en cada empresa y su email y teléfono de trabajo."
              action={
                <>
                  <LinkButton href="/app/connections/new/apollo">
                    <Plus className="size-4" />
                    Conectar Apollo
                  </LinkButton>
                  <LinkButton href="/app/connections/new/lusha" variant="ghost">
                    Conectar Lusha
                  </LinkButton>
                </>
              }
            />
          ) : (
            sources.map((source) => (
              <Choice
                key={source.id}
                card
                name="data"
                value={source.id}
                defaultChecked={data.has(source.id)}
                label={
                  <span className="flex flex-wrap items-center gap-2">
                    {source.label}
                    {source.status !== "active" ? <Badge tone="danger">Con errores</Badge> : null}
                  </span>
                }
                description={SOURCE_HELP[source.provider]}
              />
            ))
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Herramientas conectadas (MCP)</h3>
          {servers.length === 0 ? (
            <EmptyState
              compact
              icon={<Plug />}
              title="No hay servidores MCP conectados"
              description="Conecta cualquier herramienta que ofrezca MCP (un CRM, un directorio de empresas, tu base de datos…) y elige aquí qué puede usar este agente."
              action={
                <LinkButton href="/app/connections/new/mcp">
                  <Plus className="size-4" />
                  Conectar un servidor MCP
                </LinkButton>
              }
            />
          ) : (
            servers.map((server) => (
              <fieldset key={server.id} className="rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium">
                  {server.label}
                  {server.status !== "active" ? (
                    <span className="ml-2">
                      <Badge tone="danger">Con errores</Badge>
                    </span>
                  ) : null}
                </legend>
                {server.tools.length === 0 ? (
                  <p className="text-sm text-muted">Este servidor no ofrece herramientas.</p>
                ) : (
                  <ul className="space-y-2">
                    {server.tools.map((t) => {
                      const value = `${server.id}::${t.name}`;
                      return (
                        <li key={t.name}>
                          <Choice
                            name="mcp"
                            value={value}
                            defaultChecked={allowed.has(value)}
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
                      );
                    })}
                  </ul>
                )}
              </fieldset>
            ))
          )}
        </div>
      </ActionForm>
    </Card>
  );
}
