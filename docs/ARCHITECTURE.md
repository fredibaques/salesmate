# Arquitectura (fases 0 y 1)

Este documento describe el código tal como está. La visión completa está en
[PLAN.md](PLAN.md).

## Stack

| Capa | Elección |
|---|---|
| App | Next.js 16 (App Router, Server Actions, `proxy.ts`), React 19, Tailwind 4 |
| Datos | Postgres 16 vía Drizzle ORM. Local y tests: PGlite (Postgres en WASM). Producción: cualquier Postgres (`postgres-js`) |
| Auth | Better Auth (email + contraseña, Google opcional) con el plugin de organizaciones |
| Validación | Zod |
| Tests | Vitest con PGlite en memoria y `fetch` simulado |

**Por qué Better Auth** y no Clerk o Supabase Auth: se aloja en nuestra propia
base de datos (sin dependencia de un proveedor), trae organizaciones, miembros
e invitaciones (lo que necesita el SaaS) y funciona igual con PGlite, Neon o
Supabase.

## Estructura

```
src/
  app/                      Rutas (UI en español) y route handlers
    (auth)/                 Registro y acceso
    onboarding/             Creación de la organización
    app/                    Área privada: panel, bandeja, conexiones, auditoría, proyectos
    api/auth/               Better Auth
    api/connections/google/ OAuth para conectar buzones y calendarios
    api/webhooks/twenty/    Webhooks firmados de Twenty → inbound_events
    api/cron/               Liberación de acciones programadas
  components/               UI mínima (sin librería de componentes)
  server/
    db/                     Esquema Drizzle, cliente, migraciones, withTenant()
    auth/                   Better Auth y helpers de sesión/tenant
    gateway/                Action Gateway: definiciones, políticas, flujo
    connectors/             Capacidades, Twenty, Google, ejecutor, servicio de conexiones
    calendar/               Cálculo de huecos y disponibilidad global
    knowledge/              Ingesta de tablas y documentos, consulta y búsqueda
    services/               Casos de uso de la UI (proyectos, reglas, listados)
    crypto.ts               AES-256-GCM para credenciales, firma HMAC
    audit.ts                Registro de auditoría
drizzle/                    Migraciones SQL (0000 crea el rol de RLS)
tests/                      Helpers de test (BD, fetch simulado)
```

## Aislamiento entre organizaciones (RLS)

Todas las tablas de dominio llevan `org_id` y una política RLS
`org_id = current_setting('app.org_id')` para el rol `salesmate_app`.
`withTenant(db, { orgId }, fn)` abre una transacción, fija `app.org_id` y hace
`SET LOCAL ROLE salesmate_app`, de modo que la política se aplica aunque la
conexión sea la del propietario de la base de datos. `withSystem()` solo se usa
en caminos estrechos que deben localizar la organización primero (webhooks,
cron). `audit_log` es de solo inserción para el rol de la app.

## Action Gateway

`proposeAction()` es la única puerta hacia el exterior:

1. Valida el tipo y el contenido con el esquema de la acción (`gateway/definitions.ts`).
2. Resuelve la conexión (por la identidad del contenido o por las capacidades del proyecto).
3. Evalúa las políticas (`gateway/policies.ts`): estado del proyecto y botón de parada,
   identidad asignada, conexión activa, exclusiones, reglas de canal, enfriamiento
   entre proyectos, límite diario, franja de envío, reglas «solo personas»,
   avisos obligatorios y cifras respaldadas por una fuente de verdad.
4. Calcula la autonomía efectiva (configuración del agente, limitada por la acción;
   una persona que actúa directamente equivale a la aprobación).
5. Guarda la acción (idempotente por `idempotency_key`) y la ejecuta, la programa,
   la deja pendiente de aprobación o la bloquea. Todo queda auditado.

`decideAction()` aprueba (re-validando lo editado y las reglas de bloqueo) o
rechaza. `executeAction()` reclama la fila con un `UPDATE … WHERE status =
'approved'`, así que una acción nunca se ejecuta dos veces.
`releaseDueActions()` re-evalúa franja y límites de las programadas.

## Conectores

Los agentes y el gateway hablan en **capacidades** (`crm.create_task`,
`email.send`, `calendar.free_busy`…; ver `connectors/types.ts`). Cada proveedor
implementa las suyas según los permisos concedidos. Las credenciales se guardan
cifradas; si un proveedor devuelve 401/403 la conexión pasa a `error`.

- **Twenty**: REST (`/rest`, `/rest/metadata`), descubrimiento de objetos
  (incluidos los personalizados) y verificación HMAC de webhooks.
- **Google**: OAuth con permisos a elegir (disponibilidad, reuniones, envío,
  lectura), refresco de tokens persistido, Gmail (MIME UTF-8) y Calendar.

## Conocimiento

- Todo lo que se sube cuenta: no hay fuentes «orientativas» ni validación
  aparte. Si algo cambia, se sube la versión nueva y se borra la antigua.
- **Tablas** (CSV/XLSX): las hojas pensadas para personas (títulos
  combinados, notas, varias tablas una debajo de otra, condiciones al pie)
  se separan en tablas con su título, su nota y cabeceras de varias filas
  (`segmentSheet`). Tipado automático (números en formato español o inglés,
  fechas, booleanos) y consulta estructurada con parámetros (`queryTable`).
  Sus filas también se indexan como texto («Trámite: Transferencia ·
  Honorarios: 30…») para que la búsqueda normal las encuentre.
- **Documentos** (PDF, DOCX, Markdown, HTML, texto): fragmentos por párrafo y
  búsqueda de texto completo sin acentos con citas (`searchKnowledge`).
- Se guarda el fichero original (`kb_files`) para verlo o descargarlo, y el
  texto completo extraído (`kb_documents.content`).
- «Pregúntale al conocimiento» (`agents/knowledge-answer.ts`) responde con la
  IA usando solo el conocimiento: las tablas pequeñas van enteras en el
  prompt, los documentos se buscan, y devuelve las fuentes usadas.
- El gateway solo acepta cifras en mensajes salientes si citan una fuente del
  conocimiento del proyecto.

## IA de cada organización

La plataforma no tiene clave de IA propia. Cada organización conecta la suya
(`org_ai`: una por organización) con **Anthropic**, **OpenAI** o **Kimi** y
elige el modelo en *Configuración → IA*. Sin ella, la IA está apagada:
Copilot y las propuestas piden conectarla, los mensajes entrantes esperan en
la cola y el planificador salta a sus agentes sin consumir la franja.

- **Una interfaz, tres proveedores.** Los agentes hablan la forma de la API
  Messages de Anthropic (`LlmClient.create`). Claude la usa tal cual; OpenAI y
  Kimi pasan por la API Responses (Kimi ofrece una compatible): las
  herramientas propias se traducen a `function`, `web_search` a su búsqueda
  del lado del servidor (que también abre páginas; `web_fetch` no tiene
  equivalente) y el esfuerzo se ajusta a los niveles de cada modelo. Las
  llamadas no guardan estado (`store: false`): la salida cruda de cada turno
  viaja en un bloque marcador y se reenvía tal cual, así el razonamiento y las
  búsquedas siguen siendo válidos en el bucle.
- **La clave** se comprueba gratis listando los modelos de la cuenta (y que el
  elegido esté), se guarda cifrada (AES-256-GCM, como las conexiones) y solo se
  muestran sus 4 últimos caracteres. La auditoría registra altas, cambios y
  bajas sin la clave.
- **Errores de cuenta.** Si el proveedor rechaza la clave, el saldo o el
  modelo, `org_ai` pasa a `error` con un mensaje en español que muestran la
  pantalla de IA y los avisos (`AiNotice`); la siguiente llamada correcta lo
  limpia. Límites de velocidad y caídas no marcan la cuenta.
- **Coste.** `estimateCostUsd` usa los precios públicos de cada modelo
  (`lib/ai-providers.ts`), incluida la búsqueda web; la pantalla de IA suma el
  mes en curso a partir de `agent_runs`.

## Agentes (fase 1)

```
src/server/
  llm/client.ts        Interfaz inyectable (forma de la API Messages) y cliente de Claude con fallbacks del servidor
  llm/responses-api.ts OpenAI y Kimi por la API Responses, traducidos a y desde la forma Messages
  llm/org-ai.ts        Cuenta de IA de cada organización: clave cifrada, cliente por organización, estado
  lib/ai-providers.ts  Proveedores, modelos, precios y niveles de razonamiento
  llm/agent-loop.ts    Bucle de herramientas append-only, validación zod, traza y coste
  agents/tools.ts      Herramientas: conocimiento, tablas, CRM, disponibilidad y propose_action
  agents/inbound.ts    Evento entrante → contacto → conversación → ejecución del agente
  agents/leads.ts      Normalización de formularios y emails (alias en español e inglés)
  agents/gmail-poller.ts  Lectura de buzones con permiso de lectura → inbound_events
  agents/copilot.ts    Chat sobre un proyecto, con las mismas herramientas
  agents/prospector.ts Ejecución de prospección (web + MCP → prospects)
  agents/scheduler.ts  Agentes con horario: cuáles tocan y ejecución única por franja
  connectors/mcp.ts    Servidores MCP: alta, herramientas y llamadas
  playbooks/           Especificación, plantillas, versiones y borrador con IA (salida estructurada)
  services/agents.ts   Agentes de un proyecto: añadir, proceso, canales, autonomía y perfil de venta
```

- **El agente es la unidad de configuración.** El usuario añade un agente a
  un proyecto (`agent_configs.added_at`) y lo configura en su ficha: su
  **proceso** (un playbook propio, versionado, enlazado por
  `playbooks.agent_config_id`), sus **canales** (`agent_configs.channels`:
  buzón, calendario y CRM elegidos entre las conexiones de la organización) y
  su **autonomía**. Lo común a todos los agentes del proyecto (oferta, cliente
  ideal, objeciones, tono, firma) vive en `projects.sales_profile` y se
  combina con el proceso al montar el prompt.
- **Canales derivados.** `project_identities` y `project_connections` (lo que
  el gateway y las herramientas comprueban) se recalculan a partir de los
  canales de los agentes del proyecto (`syncProjectChannels`); el usuario no
  los toca. Leer correo entrante solo se habilita si el agente lo pide.
- **Solo trabajan los agentes activos.** La cola de entradas solo procesa
  proyectos con el agente inbound añadido y activado; el resto espera. El
  lead simulado lo atiende igualmente para poder probar antes de activar.

- **Los agentes nunca actúan directamente.** Su única herramienta con efecto
  externo es `propose_action`, que entra en el Action Gateway con
  `actorType: "agent"`; la autonomía del proyecto decide si se ejecuta, se
  programa o espera aprobación.
- **Prompt estable y cacheable.** El *system prompt* contiene proyecto,
  identidades y playbook (cambia solo al cambiar el playbook); la hora y el
  mensaje del contacto van en el turno de usuario. El historial del bucle es
  solo de anexado.
- **Entradas.** Formularios: `POST /api/inbound/form/:projectId` con la clave
  del proyecto; se procesa justo después de responder (`after()`). Email y
  pendientes: `GET /api/cron/inbound` desde el workflow programado.
- **Trazabilidad.** Cada ejecución queda en `agent_runs` (pasos, tokens,
  coste); cada conversación guarda mensajes entrantes y salientes (los emails
  enviados se registran tras ejecutarse, vía `afterExecute`).
- **Tests sin red.** `tests/helpers/fake-llm.ts` reproduce turnos guionizados
  del modelo para probar agentes de forma determinista.

## Agentes genéricos: instrucciones, herramientas y horario

Cada agente es la misma pieza configurada de forma distinta; inbound y
prospección son plantillas (`AGENT_DEFAULTS` en `services/agents.ts`):

- **Instrucciones** (`agent_configs.instructions`): qué tiene que hacer y cómo,
  en palabras del usuario. Se suman al prompt junto a «Oferta y cliente».
- **Herramientas** (`agent_configs.tools`): el conocimiento siempre; la
  búsqueda y lectura web de la API (`web_search` / `web_fetch`, herramientas
  del servidor, con tope de usos y coste por búsqueda en `agent_runs`); y las
  herramientas de los servidores MCP de la organización que el usuario marque.
- **Horario** (`agent_configs.schedule`, hora y días en la zona del proyecto):
  `GET /api/cron/agents` ejecuta los que tocan (`agents/scheduler.ts`). Cada
  franja se reclama con un `UPDATE` condicional sobre `last_scheduled_run_at`,
  así que dos llamadas solapadas no la ejecutan dos veces.

**MCP** (`connectors/mcp.ts`). La organización añade un servidor (URL y token
cifrado); se listan sus herramientas y se guardan en `connections.metadata`.
Las que el servidor marca como de solo lectura (`readOnlyHint`) las llama el
agente directamente; el resto se proponen al gateway como `mcp.call_tool`
(conexión indicada en el contenido), de modo que autonomía, aprobación y
auditoría se aplican igual que a un email. La plataforma hace de cliente MCP a
propósito: con el conector MCP de la API las llamadas no pasarían por el gateway.

**Prospección** (`agents/prospector.ts`, `prospects/service.ts`). El agente
outbound busca empresas que encajan con el cliente ideal y las guarda con
`save_prospects` en `prospects`, sin duplicados por proyecto (dominio de la
web, o nombre y ciudad). Cada prospecto guarda las URLs de donde salen sus
datos. No contacta con nadie. Se revisan, descartan y exportan a CSV desde la
pestaña «Prospectos» del agente.

## Pendiente

- Varios agentes de la misma plantilla en un proyecto (hoy uno por tipo).
- Enviar prospectos al CRM o a una secuencia de emails (con aprobación).
- Account Manager (fase 3).
- Gmail push (Pub/Sub) para responder en segundos también por email.
- Worker de workflows durables (Inngest/Trigger.dev) en lugar del cron simple.
- Embeddings (pgvector) para complementar la búsqueda de texto completo.
