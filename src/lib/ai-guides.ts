import type { AiProvider } from "./ai-providers";

/**
 * How to get a working API key from each provider, step by step, for the
 * connection wizard. Links go to the exact console page of each step.
 */

export type GuideStep = { title: string; detail?: string; link?: { label: string; href: string } };

export type AiGuide = {
  /** One line under the provider's option in the first step. */
  summary: string;
  steps: GuideStep[];
  /** What usually goes wrong, shown under the steps. */
  watchOut: string[];
};

export const AI_GUIDES: Record<AiProvider, AiGuide> = {
  anthropic: {
    summary: "Modelos Claude. Busca en la web y lee páginas. Pago por adelantado.",
    steps: [
      {
        title: "Entra en la consola de Claude",
        detail: "Crea una cuenta o inicia sesión. Es distinta de la suscripción a Claude.ai.",
        link: { label: "Abrir la consola", href: "https://platform.claude.com/" },
      },
      {
        title: "Añade saldo",
        detail:
          "La API es de prepago: sin saldo, las peticiones fallan. Ahí ves también tu límite de gasto mensual.",
        link: { label: "Abrir Facturación", href: "https://platform.claude.com/settings/billing" },
      },
      {
        title: "Crea la clave",
        detail:
          "Pulsa «Create key», llámala «SalesMate», elige la caducidad y un solo workspace (el que viene por defecto sirve).",
        link: { label: "Abrir API keys", href: "https://platform.claude.com/settings/keys" },
      },
      {
        title: "Cópiala",
        detail: "Empieza por sk-ant-. Solo se muestra una vez: si la pierdes, crea otra.",
      },
    ],
    watchOut: [
      "Las claves que valen para varios workspaces no funcionan aquí: crea una para un solo workspace.",
      "Si quieres ver el gasto de SalesMate aparte y ponerle un límite, crea un workspace solo para él y la clave dentro.",
    ],
  },
  openai: {
    summary: "Modelos GPT. Busca en la web (también abre páginas). Pago por adelantado.",
    steps: [
      {
        title: "Entra en la plataforma de OpenAI",
        detail:
          "Es una cuenta de desarrollador: la suscripción a ChatGPT (Plus, Pro…) no incluye uso de la API.",
        link: { label: "Abrir la plataforma", href: "https://platform.openai.com/" },
      },
      {
        title: "Añade saldo",
        detail: "En Settings → Billing compra crédito. Sin saldo, las peticiones fallan.",
        link: {
          label: "Abrir Billing",
          href: "https://platform.openai.com/settings/organization/billing/overview",
        },
      },
      {
        title: "Crea la clave",
        detail:
          "Pulsa «Create new secret key», llámala «SalesMate», elige el proyecto y deja los permisos en «All».",
        link: { label: "Abrir API keys", href: "https://platform.openai.com/api-keys" },
      },
      {
        title: "Cópiala",
        detail: "Empieza por sk-. Solo se muestra una vez: si la pierdes, crea otra.",
      },
    ],
    watchOut: [
      "Antes de crear la primera clave puede pedirte verificar tu teléfono.",
      "Con permisos restringidos, la clave necesita al menos acceso a Responses y a Models.",
    ],
  },
  kimi: {
    summary: "Modelos Kimi (Moonshot AI). Busca en la web. Pago por adelantado.",
    steps: [
      {
        title: "Entra en la consola de Kimi",
        detail: "Usa la plataforma internacional (platform.kimi.ai) y regístrate.",
        link: { label: "Abrir la consola", href: "https://platform.kimi.ai/console" },
      },
      {
        title: "Recarga al menos 10 $",
        detail:
          "Con 1 $ ya funciona, pero hasta los 10 $ acumulados solo admite una petición a la vez y 3 por minuto: los agentes se quedarían atascados. Al llegar a 5 $ te regalan un bono de 5 $.",
      },
      {
        title: "Crea la clave",
        detail: "En API Keys crea una nueva y llámala «SalesMate».",
        link: { label: "Abrir API Keys", href: "https://platform.kimi.ai/console/api-keys" },
      },
      { title: "Cópiala", detail: "Empieza por sk-." },
    ],
    watchOut: [
      "Las claves de la plataforma china (platform.moonshot.cn) no sirven aquí: son cuentas distintas.",
      "Los bonos regalados no cuentan para subir de nivel: solo lo que recargas.",
    ],
  },
};
