/** How each project agent is presented to the user. */
export const AGENT_INFO = {
  inbound: {
    name: "Agente inbound",
    short: "Inbound",
    description:
      "Atiende a quien te contacta por el formulario de tu web o por email: le responde, lo cualifica y lo lleva al siguiente paso.",
  },
  outbound: {
    name: "Agente outbound",
    short: "Outbound",
    description:
      "Busca empresas o personas que encajan con tu cliente ideal y les escribe para abrir conversación.",
  },
  account_manager: {
    name: "Account Manager",
    short: "Account Manager",
    description:
      "Cuida a tus clientes actuales: seguimiento, renovaciones y oportunidades de ampliar lo que te compran.",
  },
} as const;

export type ProjectAgentKey = keyof typeof AGENT_INFO;
