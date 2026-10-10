/** How each project agent is presented to the user. */
export const AGENT_INFO = {
  prospecting: {
    name: "Agente de prospección",
    short: "Prospección",
    description:
      "Recoge información de distintas fuentes, sobre todo internet: busca empresas o personas que encajan con tu cliente ideal y completa los datos de tus tablas.",
  },
  outbound: {
    name: "Agente outbound",
    short: "Outbound",
    description:
      "Inicia el proceso comercial con las filas de una tabla que encajan: prepara un primer email personal para cada una y lo envía con tu aprobación.",
  },
  inbound: {
    name: "Agente inbound",
    short: "Inbound",
    description:
      "Atiende a quien muestra interés por su cuenta (formulario de la web, email, WhatsApp…): le responde, lo cualifica y lo lleva al siguiente paso.",
  },
  account_manager: {
    name: "Account Manager",
    short: "Account Manager",
    description:
      "Cuida a tus clientes actuales: seguimiento, renovaciones y oportunidades de ampliar lo que te compran.",
  },
} as const;

export type ProjectAgentKey = keyof typeof AGENT_INFO;

/** The agent's name: the one the user gave it, or its template's. */
export function agentName(type: ProjectAgentKey, name?: string | null): string {
  return name?.trim() || AGENT_INFO[type].name;
}
