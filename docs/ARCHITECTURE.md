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
    connectors/             Capacidades, Twenty, Google, Apollo/Lusha/Hunter/Serper, Airtable/Trello/monday, MCP, ejecutor, servicio
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
cifradas; si un proveedor devuelve 401/403 la conexión pasa a `error`. Los
fallos HTTP se enseñan con frases (`describeConnectorError`): `runForm` lo
aplica a cualquier `ConnectorError`.

- **Desconectar** (`removeConnection` en `services/connections.ts`): borra la
  conexión y sus buzones y calendarios, y quita a los agentes lo que la
  usaba (canales, herramientas de datos y MCP, Slack de los avisos); lo que
  cada proyecto puede usar se recalcula. Lo hecho se conserva (acciones,
  conocimiento). El permiso concedido en el proveedor sigue hasta que se
  retira allí.
- **Herramientas de Google por separado**: Gmail, Google Calendar, Meet,
  Docs y Sheets se conectan y desconectan cada una por su lado, aunque por
  debajo son una sola conexión por cuenta (`provider = google`, un token).
  El formulario manda `tool` (`/api/connections/google/start`), Google
  devuelve todos los permisos concedidos hasta entonces
  (`include_granted_scopes`) y `saveGoogleConnection` solo enciende los de
  las herramientas ya activas más la nueva (`GOOGLE_TOOLS`: cada una, un
  permiso de `read_scopes`/`write_scopes`). Integraciones muestra una tarjeta
  por herramienta (`googleToolsOf`); «Desconectar» en una
  (`removeGoogleTool`) le quita su permiso y su buzón (Gmail) o calendario
  (Calendar) a la conexión y a los agentes, y la última borra la conexión.
  La rejilla de «Añadir conexión» marca cada una (`connectedTools`).
- **Twenty**: REST (`/rest`, `/rest/metadata`), descubrimiento de objetos
  (incluidos los personalizados) y verificación HMAC de webhooks.
- **Google**: OAuth con permisos a elegir por herramienta (Gmail: escribir o
  escribir y leer; Calendar: disponibilidad o también reuniones; Meet, Docs,
  Sheets), refresco de tokens persistido, Gmail (MIME UTF-8) y Calendar. Meet: `calendar.book` sin
  lugar crea la videollamada (`conferenceData`, devuelve `meetLink`). Docs
  (`documents.readonly` → `docs.read`) y Sheets (`spreadsheets` →
  `sheets.read` y `table.export`, que crea una hoja nueva). Son permisos
  sensibles: en producción, más allá de los usuarios de prueba, Google exige
  verificar la app.
- **Apollo y Lusha** (`connectors/data.ts`): proveedores de datos B2B con API
  key, solo lectura (permiso `data`). Capacidades `data.search_people` y
  `data.search_companies` (Apollo), `data.enrich_person` y
  `data.enrich_company` (los dos) y `data.check` para validar la clave antes
  de guardarla. Apollo por `https://api.apollo.io/api/v1` (`x-api-key`;
  buscar personas no gasta créditos y no da contacto); Lusha por su API v2
  (`api_key`; un 404 es «sin resultado», sin gasto). Solo datos de contacto
  profesionales: Apollo sin emails personales, Lusha sin emails privados ni
  teléfonos marcados «no llamar». Como solo leen, el agente los usa
  directamente (`dataTools`), no por el gateway; el agente de prospección los
  recibe si se marcan en su pestaña Herramientas (`agent_configs.tools.data`)
  y cita como fuente la ficha del registro en el proveedor.
- **Hunter** (`createHunterClient`, `X-API-KEY`): busca personas por dominio
  (`/domain-search`, exige `companyDomains`, una búsqueda por empresa, máx. 5),
  encuentra el email por nombre y dominio (`/email-finder`), datos de empresa
  (`/companies/find`) y `data.verify_email` (`/email-verifier`), que los
  agentes reciben como herramienta `hunter_verify_email`.
- **Serper** (`createSerperClient`, `POST google.serper.dev/search`,
  `X-API-KEY`): resultados de Google (`data.web_search`, título, URL,
  extracto y la web oficial del panel de Google). Comprobar la clave gasta
  una búsqueda (no tiene un endpoint gratuito). Lo usa el motor de
  completado para encontrar la web de las filas sin ella, y los agentes
  como `serper_search` (el prompt les pide usarlo antes que `web_search`).
- **Airtable, Trello y monday.com** (`connectors/workspace.ts`, permiso
  `workspace`): token (Trello: key y token), comprobado al conectar.
  `export.targets` lista bases, listas («Tablero › Lista») o tableros.
  `table.export` crea una tabla nueva en la base de Airtable (todo como texto,
  lotes de 10 registros) o una tarjeta/elemento por fila (máx. 100 por
  exportación) con los campos en la descripción. Trello y monday tienen
  además `task.create` en la lista o tablero por defecto de la conexión
  (`metadata.taskTarget`, se elige en su tarjeta de Integraciones).

## Conocimiento

- **De la cuenta o de un proyecto.** `knowledge_sources.project_id` nulo es
  conocimiento de toda la cuenta (sección Conocimiento del menú, `/app/knowledge`):
  lo usan los agentes de todos los proyectos junto con el propio del proyecto
  (`knowledgeOf(projectId)` en búsqueda, tablas, «Pregúntale», borradores de
  proceso y la política de cifras). Se añade igual (fichero, texto, Google) y
  una fuente se mueve entre la cuenta y un proyecto (`setSourceProject`,
  «Mover» en su página). La pestaña Conocimiento de un proyecto muestra lo
  suyo y, aparte, lo de toda la cuenta.
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
  conocimiento del proyecto o de la cuenta.
- «Desde Google» (`knowledge/google-import.ts`) copia un Google Doc como
  documento o la primera pestaña de un Google Sheet como tabla (vía CSV),
  probando cada cuenta de Google conectada con permiso de lectura; 403/404
  pasan a la siguiente. Es una copia: si cambia en Google, se vuelve a importar.

## Reuniones y transcripciones de Meet

- Tabla `meetings` (migración 0017). Al ejecutarse un `calendar.book`,
  `recordBookedMeeting` (en `afterExecute` del gateway) guarda la reunión con
  su conversación (`context.subjectRef`), la conexión de Google del
  calendario y el código de Meet (`meetCodeOf`); sin Meet queda `manual`.
- El permiso `meet_read` (`meetings.space.readonly`, se pide desde la
  ficha «Google Meet») da la capacidad `meet.transcript`: Meet REST API v2,
  `conferenceRecords` filtrados por código y ventana de tiempo →
  `transcripts` → `participants` (nombres) → `entries` (paginadas, máx. 30
  páginas de 100). Varias sesiones de la misma llamada se juntan en orden.
- `syncPendingTranscripts` (cron `/api/cron/inbound`, 5 por llamada) mira
  las reuniones en `waiting` desde 5 minutos después del final y cada 10
  minutos. Si está: la guarda, la resume con la IA de la organización
  (`json_schema`: resumen y siguientes pasos), deja una nota interna
  (`channel: "meet"`) en la conversación y pone los siguientes pasos en
  `conversations.next_step`. «Sin transcripción» solo es definitivo 2 horas
  después del final (la llamada puede empezar tarde o alargarse); a las 48
  horas se deja de buscar. Sin permiso o con 401/403 → `error`, con el
  motivo en `last_error`; «Buscar ahora» lo vuelve a intentar.
- Pestaña Reuniones del proyecto: lista, ficha con resumen, siguientes
  pasos y transcripción, y «Traer de Google Meet» para cualquier llamada de
  los últimos 30 días por su enlace (`importMeetTranscript`, solo si ya
  tiene transcripción). La conversación enlaza sus reuniones.
- La transcripción solo existe si alguien la activa en la llamada (planes
  de Google Workspace que la incluyen).

## Exportar tablas y tareas del equipo

- `table.export` (gateway, `connectionVia: "payload"`, no saliente): el
  ejecutor lee la tabla en ese momento (`tableForExport`, las nuevas o todas),
  la escribe con la conexión elegida y marca como exportadas las filas nuevas
  que salieron (`markExported`; las herramientas de una fila por tarjeta
  paran en 100). El CSV usa las mismas funciones. En la tabla: Exportar → «A
  otra herramienta…» (`?send=1`) abre el modal con destino, lista/base/tablero
  y qué filas.
- `task.create`: el agente inbound lo tiene si hay una conexión de Trello o
  monday con lista o tablero de tareas; el prompt le explica cuándo usarlo.

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
- **Conexión guiada** (`/app/ai/connect`): elegir proveedor, cómo conseguir
  la clave en su consola (`lib/ai-guides.ts`: pasos con enlace a cada página y
  lo que suele fallar) y pegarla. «Cambiar» abre un modal rápido con enlace a
  la guía.
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
  agents/prospector.ts Ejecución de prospección (web + MCP → filas de una base de prospectos)
  prospects/bases.ts   Bases de prospectos del proyecto y la base que rellena cada agente
  prospects/service.ts Filas: guardar sin duplicados, listar, filtrar, ordenar y exportar
  prospects/agent-schema.ts  Esquema de save_prospects y prompt a partir de las columnas de la base
  prospects/propose-columns.ts  Columnas propuestas por la IA para una base nueva
  prospects/complete.ts  Celdas por completar y cómo las rellena el agente sin pisar lo escrito a mano
  agents/scheduler.ts  Agentes con horario: cuáles tocan y ejecución única por franja
  connectors/mcp.ts    Servidores MCP: alta, herramientas y llamadas
  playbooks/           Proceso de venta del proyecto: especificación, plantillas, versiones y borrador con IA
  services/agents.ts   Agentes de un proyecto: añadir, canales, autonomía, perfil y proceso de venta
```

- **El agente es la unidad de configuración.** El usuario añade agentes a
  un proyecto (`agent_configs.added_at`), **tantos de cada tipo como quiera**
  (uno capta leads en una tabla, otro la enriquece…): el tipo (`agent_type`)
  es la plantilla y decide qué hace una ejecución. Cada agente se identifica
  por su id (`/app/projects/:id/agents/:agentId`; las direcciones antiguas
  con el tipo llevan al primero de ese tipo) y se configura en su ficha: sus
  **canales** (`agent_configs.channels`: buzón, calendario y CRM elegidos
  entre las conexiones de la organización) y su **autonomía**. El segundo de
  un tipo se llama «Agente inbound 2» hasta que se le pone nombre (el
  asistente lo pide). Las ejecuciones (`agent_runs.agent_config_id`), las
  acciones (`actions.agent_config_id`: su autonomía y sus límites) y el estado
  «trabajando» son de cada agente; la migración 0024 asignó lo anterior al
  único agente de su tipo que había.
- **La venta es del proyecto** (pestaña «Ventas»). «Oferta y cliente»
  (`projects.sales_profile`: oferta, cliente ideal, señales de encaje,
  objeciones, tono, firma) lo conocen todos los agentes. El **proceso de
  venta** (cómo termina una conversación, cualificación, reglas, cuándo pasar
  a una persona) es un playbook del proyecto, versionado, sin
  `agent_config_id` (`projectProcess`, `getProjectProcess`,
  `saveProjectProcess`). Lo siguen los agentes que hablan con personas
  (inbound, primeros contactos, cuentas); añadir uno lo crea desde la
  plantilla del tipo de venta si el proyecto no tiene (`ensureProjectProcessIn`).
  Los que solo buscan o completan datos (prospección) no lo usan: les basta
  «Oferta y cliente». La migración 0023 convirtió el proceso del inbound de
  cada proyecto (o el más reciente) en el del proyecto.
- **Canales derivados.** `project_identities` y `project_connections` (lo que
  el gateway y las herramientas comprueban) se recalculan a partir de los
  canales de los agentes del proyecto (`syncProjectChannels`); el usuario no
  los toca. Leer correo entrante solo se habilita si el agente lo pide.
- **Solo trabajan los agentes activos.** La cola de entradas solo procesa
  lo que puede atender un agente inbound añadido y activado; el resto espera.
  El lead simulado lo atiende igualmente para poder probar antes de activar.
- **Cada entrada tiene su agente** (`inboundAgentFor` en `agents/inbound.ts`).
  Lo que llega por el webhook, la tabla o el WhatsApp de un agente lleva su id
  (`inbound_events.agent_config_id`) y solo lo atiende él. El formulario de la
  web (uno por proyecto) va a los que lo atienden y un email a los que leen
  ese buzón; entre ellos, el agente cuya ejecución está repasando la cola,
  si no el primero activo. La ejecución de un agente (`runInboundSweep`)
  atiende lo suyo y lo del proyecto que no es de nadie.

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
- **Trazabilidad.** Cada ejecución queda en `agent_runs` (pasos, tokens de
  entrada, salida y caché leída/escrita, búsquedas web, coste); cada conversación guarda mensajes entrantes y salientes (los emails
  enviados se registran tras ejecutarse, vía `afterExecute`).
- **Tests sin red.** `tests/helpers/fake-llm.ts` reproduce turnos guionizados
  del modelo para probar agentes de forma determinista.

## Agentes genéricos: instrucciones, herramientas y horario

Cada agente es la misma pieza configurada de forma distinta. Hay tres tipos,
en el orden de la venta, cada uno una plantilla (`AGENT_DEFAULTS` en
`services/agents.ts`) con su propia ejecución:

- **Prospección** (`prospecting`, `agents/prospector.ts`): recoge información
  de distintas fuentes, sobre todo internet; busca filas nuevas que encajan y
  completa las celdas vacías de su tabla. No escribe a nadie.
- **Outbound** (`outbound`, `agents/outreach.ts`): inicia el proceso
  comercial con las filas de una tabla (normalmente la que rellena uno de
  prospección): a las que tienen email y el encaje mínimo, y aún no tienen
  primer email, les escribe uno siguiendo el proceso de venta del proyecto
  y lo propone (`prepareFirstContacts`). Las respuestas llegan a su
  conversación.
- **Inbound** (`inbound`, `agents/inbound.ts`): atiende a quien muestra
  interés por su cuenta (formulario, email, WhatsApp, filas, avisos).

La migración 0025 convirtió los antiguos «outbound» (que buscaban filas) en
`prospecting`; el primer contacto, que antes era un paso opcional de ese
agente, es ahora el trabajo del outbound. Lo común a todos:

- **Instrucciones** (`agent_configs.instructions`): qué tiene que hacer y cómo,
  en palabras del usuario. Se suman al prompt junto a «Oferta y cliente».
- **Herramientas** (`agent_configs.tools`): el conocimiento siempre; la
  búsqueda y lectura web de la API (`web_search` / `web_fetch`, herramientas
  del servidor, con tope de usos y coste por búsqueda en `agent_runs`); y las
  herramientas de los servidores MCP de la organización que el usuario marque.
  En la pestaña se ven como tarjetas («En uso»); «Herramientas disponibles»
  abre un modal con lo que se puede añadir (web, Apollo/Lusha/Hunter y
  servidores MCP conectados) y lo que falta por conectar. Añadir un servidor
  MCP le da todas sus funciones; «Elegir funciones» las limita
  (`addAgentTool`, `removeAgentTool`, `setAgentMcpTools`).
- **Color del proyecto** (`projects.color`, migración 0018): una clave de la
  paleta de los agentes (`AGENT_COLORS`, `colorLook`); se elige al crearlo,
  en Ajustes o en el engranaje del menú. Pinta su inicial en el menú y el
  icono de su cabecera.
- **Nombre** (`agent_configs.name`): el que le da el usuario; vacío = el de
  la plantilla (`agentName()` en `lib/agents.ts`). Lo usan la cabecera, el
  menú lateral, las migas y las tablas.
- **Cuándo trabaja** (`agent_configs.schedule`, en la zona del proyecto): `null`
  = solo cuando se lo piden («Ejecutar ahora»); `daily`, `weekly` (días;
  las filas sin `kind` son semanales), `monthly` (día del mes; si el mes es
  más corto, el último) u `once` (un momento `YYYY-MM-DDTHH:MM`: se ejecuta
  una vez a partir de él y vuelve a hacerlo solo si se elige otro momento
  posterior). Lo leen `isDue` y `describeNextRun` (`agents/scheduler.ts`);
  el formulario es `ScheduleFields` y `scheduleFromForm` (`lib/schedule.ts`).
  `GET /api/cron/agents` ejecuta los que tocan (`agents/scheduler.ts`), hasta
  tres a la vez en paralelo. Cada franja se reclama con un `UPDATE`
  condicional sobre `last_scheduled_run_at` (comparado al milisegundo:
  Postgres guarda microsegundos y JavaScript no), así que dos llamadas
  solapadas no la ejecutan dos veces. Cada pasada marca
  `schedule_checked_at` en los agentes activos y guarda en `schedule_note`
  por qué una franja no se ejecutó (sin IA, error); la ficha del agente
  muestra la próxima ejecución y avisa si el programador no pasa.
- **Quién llama al programador**: una Neon Function
  (`scripts/neon-scheduler`) con disparadores programados de Neon, cada 15
  minutos de día y cada hora de noche (UTC). Su clave se comprueba contra el
  hash guardado en `scheduler_keys` (tabla de plataforma sin `org_id`, con
  RLS y sin política: el rol de la app no la lee; solo `withSystem`). GitHub Actions queda de respaldo cada hora: sus
  ejecuciones programadas se retrasan o se pierden con carga.

**MCP** (`connectors/mcp.ts`). La organización añade un servidor (URL y token
cifrado); se listan sus herramientas y se guardan en `connections.metadata`.
Las que el servidor marca como de solo lectura (`readOnlyHint`) las llama el
agente directamente; el resto se proponen al gateway como `mcp.call_tool`
(conexión indicada en el contenido), de modo que autonomía, aprobación y
auditoría se aplican igual que a un email. La plataforma hace de cliente MCP a
propósito: con el conector MCP de la API las llamadas no pasarían por el gateway.

**Encaje** (`prospects/fit.ts`). No es un número que el modelo se invente:
los criterios salen de «Oferta y cliente» (a quién te diriges, zonas y a
quién no, imprescindibles; y las señales de encaje) y el agente marca cada uno
como `yes`, `no` o `unknown` en `save_prospects` (`fit`, por id c1, c2…).
`scoreFit` lo convierte en 0-100: cumple cuenta entero, sin comprobar la
mitad, los imprescindibles pesan el doble y fallar uno deja el encaje en 20
como mucho. Se guarda con sus comprobaciones (`prospects.fit_checks`), que se
ven al pasar sobre la celda y en el panel de la fila; si una persona cambia el
número a mano, las comprobaciones se borran. Sin criterios, el agente da un
número orientativo.

**Tablas** (`prospects/`, `lib/prospect-columns.ts`). Una tabla
(`prospect_bases`) puede ir con un proyecto o sola (`project_id` nulo,
migración 0019; al borrar un proyecto sus tablas se quedan, sin proyecto, y
`setBaseProject` las mueve con sus filas). No es del agente: el usuario define
sus columnas (`columns`, JSONB con id, nombre, tipo, opciones, instrucciones y
quién la rellena: agente, persona o ambos) y si cada fila es una empresa o una
persona (`row_kind`). Un agente trabaja sobre las tablas de su proyecto y las
que no tienen proyecto (`listBases(…, { standalone: true })`); el agente de prospección rellena la de
`agent_configs.prospect_base_id` (si no tiene, la primera del proyecto, o una
«Prospectos» nueva con columnas por defecto). Cada fila (`prospects`) guarda
los campos fijos (empresa, persona, web, encaje, fuentes, estado) y los valores
de las columnas en `data` por id de columna, con quién y cuándo escribió cada
celda en `cell_meta`. No hay duplicados por base (`base_id, dedupe_key`:
dominio de la web, o nombre y ciudad; en bases de personas, persona y empresa).
Cada tabla vive en `/app/tables/<id>` (las rutas antiguas bajo el proyecto
redirigen); la sección Tablas y el resumen del proyecto las listan
igual (`TablesList`). La rejilla se ve siempre, también vacía, con filtros,
orden por cualquier columna, búsqueda y exportación a CSV. Exportar a otra
herramienta pasa por el gateway, que registra por proyecto: solo en tablas con
proyecto.

Las crean los propietarios y administradores con nombre, qué es cada fila y
proyecto opcional. Solo es obligatorio el nombre de cada fila (la empresa, o
la persona en tablas de personas: es como se distinguen y se detectan
duplicados); en tablas de personas la empresa es opcional. Los demás campos
fijos (empresa en tablas de personas, web, encaje, estado, fuentes, fecha
de registro) se muestran u ocultan como columnas
(`prospect_bases.hidden_fields`, `setFieldHidden`). Cada fila tiene además
un **ID** fijo, siempre a la vista junto al nombre: 1, 2, 3… en el orden en
que llegan a su tabla (`prospects.seq`). Lo pone un trigger de la base de
datos (`prospects_next_seq`, migración 0025) con el contador de la tabla
(`prospect_bases.row_seq`), así que vale para cualquier forma de añadir
filas; una fila que ya estaba no gasta número y los de las filas borradas no
se repiten. Una tabla nueva empieza con el nombre y la fecha de registro, sin
columnas; cuando un agente pasa a rellenarla (`setAgentBase`,
`ensureAgentBase`) se muestran todos, porque los rellena él. Las
columnas se gestionan en la cabecera de la tabla, como en una hoja de cálculo
(`Popover`): el «+» añade una a mano o de las sugerencias de la IA
(`prospects/propose-columns.ts`, con la oferta del proyecto si lo tiene), y
cada cabecera abre su menú (editar, ordenar, mover, ocultar, borrar); se
reordenan arrastrando la cabecera (con el ratón, o manteniéndola pulsada en
el móvil: `column-drag.ts`, `placeColumn`). También cambian las columnas (`saveColumn`,
`moveColumn`, `setColumnHidden`, `removeColumn`): el id de una columna sale de
su nombre la primera vez y no cambia, y al cambiar su tipo u opciones los
valores que ya no encajan se borran. Cualquier miembro escribe en la propia
rejilla: un clic en una celda la edita (`setProspectCell`) y la última línea
añade una fila al escribirla (`rowEditFromValues` + `addProspectRow`); el
panel lateral (icono al pasar por el nombre) muestra la fila entera
(`updateProspectRow`, `addProspectRow`): se validan todos los
valores (no se descarta ninguno en silencio, a diferencia de lo que guarda el
agente), las celdas que cambian quedan marcadas como escritas a mano y no se
permite que una fila pase a duplicar otra. Al borrar una base, el agente que
la rellenaba pasa a la primera que quede en el proyecto.

**Tablero** (`[baseId]/kanban-board.tsx`). Una columna de tipo «Fase del
pipeline» (`stage`: como una selección única cuyas opciones son las fases, en
orden; una por tabla como mucho, `stageColumn`) permite ver la tabla como un
tablero (`?view=board`, hasta 500 filas con los mismos filtros): una lista por
fase más «Sin fase» si hay filas sin ella. Arrastrar una tarjeta guarda la
celda (`setProspectCell`, con la misma validación) y abrirla abre el panel de
la fila.

**Formularios** (`prospects/intake.ts`, `POST /api/tables/<id>/rows`). Cada
tabla puede abrirse a formularios externos con su propia clave
(`prospect_bases.intake_key`, cabecera `x-salesmate-key`, campo `_key` o
`?key=`; «Conectar formulario» en la tabla). JSON, urlencoded o multipart,
CORS abierto, `_redirect` y `_gotcha` como en el formulario del agente
inbound. Los campos se emparejan con las columnas por nombre o id (sin
acentos ni mayúsculas); empresa, nombre, web, email y teléfono por sus nombres
habituales; lo que no encaja vuelve en `ignored`. Cada envío es una fila (con
la misma deduplicación) y avisa al agente que complete filas nuevas. Es
distinto del formulario del proyecto (`/api/inbound/form/<projectId>`), que
abre una conversación con el agente inbound.

**Completar vacíos** (`prospects/complete.ts`). Una celda está «por completar»
si su columna la rellena el agente, no tiene valor y nadie la ha tocado
(`isPendingCell`). Cada celda guarda en `cell_meta` quién la escribió, cuándo,
la página de donde sale (`source`) o que el agente la buscó y no estaba
publicada (`notFound`, para no volver a buscarla). Lo que escribe una persona
queda bloqueado: el agente nunca cambia un valor existente ni una celda
escrita a mano; vaciarla la devuelve a «por completar». El agente de
prospección trabaja en un modo (`settings.mode`): buscar filas nuevas,
completar vacíos o las dos cosas, con un tope de celdas por ejecución
(`cellsPerRun`). Para completar recibe en el prompt las filas pendientes (las
de mejor encaje primero, con referencias cortas F1, F2…) y guarda con
`update_prospects`. «Completar vacíos» en la base y «Completar esta fila» en el
panel lanzan una ejecución solo de completar; la de una fila («Completar esta
fila») la hace el agente a fondo y vuelve a buscar también lo que no se
encontró. El resto (el botón de la tabla, las filas nuevas, las ejecuciones
programadas) pasa primero por el motor de completado.

**Motor de completado** (`prospects/engine/`). Rellena las celdas fila a fila
sin agente, por un camino fijo:
1. La web de la empresa: la de la fila o, si no tiene, la que encuentra
   Serper (si la organización lo ha conectado; `pickWebsite` descarta
   directorios y redes y exige que el dominio contenga una palabra del
   nombre). La que encuentra se guarda en la fila si seguía sin web.
2. Sus páginas (`reader.ts`): la de inicio y hasta 3 de contacto, aviso
   legal o quiénes somos (`usefulSubpages`). Petición HTTP normal, solo a
   direcciones públicas (DNS comprobado, sin redes privadas ni otros puertos,
   cada redirección revisada), 8 s y 1,5 MB por página, respetando
   `robots.txt` (`SalesMateBot` o `*`). Si una web no muestra texto sin
   JavaScript y hay `JINA_API_KEY`, la renderiza Jina Reader.
3. Patrones sin IA (`facts.ts`): emails, teléfonos españoles o
   internacionales, CIF y perfiles sociales; van al modelo como pistas.
4. Una sola llamada al modelo pequeño del proveedor (`smallModel`: Haiku,
   GPT-6 Luna o Kimi K2.6) con ~18.000 caracteres de las páginas y solo las
   columnas vacías, con salida JSON (`cells` con columna, valor y página;
   `notFound`). Se guarda con `completeProspects` (misma validación y
   bloqueos que el agente); una fuente que no es una página leída pasa a ser
   la de inicio, y lo que no da o no encaja con su columna queda como «no
   encontrado»: cada fila que lee queda respondida.

Trabaja 6 filas a la vez y no empieza ninguna a menos de 25 s del final ni
pasado el límite de gasto de la ejecución. Las filas que no puede leer (sin
web, web caída) pasan al agente en la misma ejecución, hasta 8 si le quedan
45 s y tiene web o herramientas de datos (lo que no encuentre queda como no
encontrado, `closeRows`); sin ellas se marcan como no encontradas. En una
ejecución que también busca filas nuevas, el motor deja 90 s al agente.
Cada fila acumula su coste en `prospects.cost_usd` (modelo pequeño, cada
búsqueda de Serper a 0,001 $ y, si la tomó el agente, su parte del coste):
se ve en la ficha de la fila y, en total y por fila, al pie de la tabla. La
ejecución guarda los pasos del motor (`buscar_web`, `leer_web`,
`completar_fila`) en su registro. «Completar vacíos» completa la tabla
entera (`allPending`): toma hasta 3.000 celdas, la ejecución acaba cuando se
le acaba el tiempo y, si quedan celdas y ha avanzado, deja un evento
`continue` para que el planificador lance la siguiente tanda. Cuando la
ejecución es del agente, mientras queden celdas y tiempo `onEnd` de
`runAgentLoop` le pide seguir (hasta 4 veces); los errores de las
herramientas del servidor quedan en los pasos del registro.

**Prospección** (`agents/prospector.ts`). El agente outbound busca lo que
encaja con el cliente ideal y lo guarda con `save_prospects` en su base. El
esquema JSON de la herramienta y una sección del prompt se generan a partir de
las columnas (tipos, opciones e instrucciones; las columnas que rellenan las
personas no se le muestran). Los valores se validan por campo con
`checkCell`: uno que no encaja con su columna se descarta y se le devuelve en
`fieldErrors`, sin perder la fila. Cada fila guarda las URLs de donde salen sus
datos. No contacta con nadie.

Guarda por tandas para no perder lo encontrado si se acaba el tiempo
(~170 s por ejecución): la búsqueda web se limita a 3 búsquedas y 6
lecturas por petición (se ejecutan dentro de una sola petición, así que un
tope alto dejaba una vuelta más larga que todo el presupuesto), el prompt
pide guardar cada 2 o 3 empresas, y entre vueltas `prospectingSteer` le
recuerda guardar tras 8 búsquedas o lecturas sin hacerlo y, a 45 s del
final, que deje de buscar y guarde lo confirmado (`steer` de
`runAgentLoop`, texto tras los resultados de las herramientas).

## Un agente trabajando

Mientras completa celdas, la ejecución de prospección guarda qué filas tiene
entre manos (`agent_runs.target`); la tabla (`fillingRows`) muestra sus
celdas vacías como «completándose», con un brillo que recorre el texto
(`text-shimmer`), hasta que llega el valor.

`agents/working.ts` (`workingSql`) dice, como columna de una consulta sobre
`agent_configs`, si el agente tiene ahora una ejecución en marcha (de las
últimas 2 h). Lo usan el menú, las tarjetas, la cabecera del agente y los
avatares de una tabla: punto verde con pulso y el icono moviéndose mientras
trabaja, punto gris en reposo, anillo gris en pausa. La página del agente se
refresca sola mientras trabaja.

## Registro de ejecuciones y coste

`agents/runs.ts` lee `agent_runs` como un registro: `listRuns` (más recientes
primero, paginado por `startedAt`), `runTotals` (coste del periodo por agente)
y `getRun` (con sus pasos). Cada ejecución lleva su desglose
(`costBreakdown` en `llm/client.ts`): entrada, salida, caché y búsquedas web a
los precios del modelo, y «Otros» con lo que no se desglosa (borradores de
primeros emails, ejecuciones anteriores a la migración 0022). Se ve en la
pestaña «Log» de cada agente (con los resultados del agente de prospección y
el gasto del mes), en el resumen de cada proyecto (gráfico de líneas del
coste por día, semana o mes: `costSeries`, en la hora del proyecto) y en Configuración → Ejecuciones (`/app/runs`, filtros de
periodo, proyecto y agente; meses en hora de Madrid con `monthStart`).

## Automatización de los agentes

Ajustes en `agent_configs.settings` (`saveAgentAutomation` en
`services/agents.ts`). En el agente de prospección se editan junto a las
instrucciones en una sola pestaña «Configuración» (`outbound-setup.tsx`,
acción `saveAgentSetup`), agrupados en Objetivo, Ejecución, Configuración del
modelo, Comunicación y Siguiente paso; `/automation` redirige ahí:

- **Cuándo trabaja**, igual para todos los agentes: **a mano** («Ejecutar
  ahora», en su cabecera), **con horario** (`agent_configs.schedule`, el
  programador: `runDueAgents`) y **cuando pasa algo** (`triggers`). Qué hace
  una ejecución es propio de cada agente: el de prospección busca o completa
  filas; el inbound (`runInboundSweep`) lee su buzón y atiende lo pendiente
  de su proyecto, cada contacto en su propia ejecución. Eventos:
  - Prospección: una fila nueva en su tabla (la completa) y un aviso en su
    webhook (`POST /api/hooks/agents/<hook_token>`, el token es el secreto;
    el cuerpo entra en el prompt como «Avisos recibidos», como dato y no como
    instrucción).
  - Inbound: el formulario de la web (`triggers.form`, activo salvo que se
    apague), un email al buzón (`channels.readMailbox`), un WhatsApp
    (`channels.whatsappId`), una fila nueva con email o teléfono en su tabla
    (`rowsAdded` la encola como `inbound_events` de origen `table`, una vez
    por fila) y un aviso en su webhook (`queueWebhookLead`: sus campos por
    nombre, origen `webhook`). Todo entra como un contacto más
    (`leadFromEvent`).
  - Tras añadir filas, `workOnAddedRows` lanza después de responder lo que
    toque a cada agente. Los eventos se guardan en `agent_events` y se
  procesan enseguida (`after()`) o en la siguiente pasada del programador si
  el agente está ocupado (`agents/events.ts`); cada evento se reclama antes de
  ejecutar, así que nunca se procesa dos veces.
- **Límites de gasto** (`budget`): por ejecución (coste y búsquedas web) el
  bucle (`runAgentLoop({ budget })`) avisa al 75 % para que guarde y para
  antes del siguiente turno (estado `budget`, cuenta como terminada); al mes
  (`monthSpendUsd`, en la zona del proyecto) no arranca más ejecuciones.
- **Objetivo** (`goal`): N filas con encaje mínimo. Al cumplirlo deja de buscar
  filas nuevas; si solo buscaba, se pone en pausa (en ejecuciones automáticas).
- **Fuentes** (`sources`): `allowed_domains` / `blocked_domains` en las
  herramientas web (la API admite una de las dos; con OpenAI y Kimi solo se
  traslada la de permitidos) y, siempre, en el prompt; y qué usar primero.
- **Modelo** (`settings.model`): otro modelo del mismo proveedor de la
  organización (`withModel` en `llm/client.ts`); si la organización cambia de
  proveedor se ignora.
- **Avisos** (`notify`, `agents/automation.ts`): al terminar o si hay un
  problema (falla, nada nuevo, límite alcanzado, objetivo cumplido), por Slack
  (conexión `slack`, un webhook entrante, capacidad `notify.slack`) o por email
  desde el buzón del agente solo a personas de la organización. Son acciones
  del gateway (`notify.slack`, `notify.email`) con `defaultAutonomy` 3: salen
  solas salvo que el agente diga otra cosa, y quedan auditadas.
- **Primer contacto** (agente outbound, `settings.handoff` con su encaje
  mínimo y emails por ejecución, `agents/first-contact.ts`): en cada
  ejecución, para las filas de su tabla con email y encaje suficiente (con
  mínimo 0, también las que nadie puntuó), escribe un primer email y lo
  propone (`email.send` desde su buzón). Con la autonomía
  por defecto espera aprobación en «Por aprobar»; el gateway aplica horario de
  envío, exclusiones y enfriamientos. `prospects.contact_action_id` evita
  repetirlo.

## WhatsApp Business

Conexión `whatsapp` (`connectors/whatsapp.ts`, API Cloud de Meta): número,
token permanente de un usuario del sistema y secreto de la app. Al conectar
se comprueba el número y se crea su identidad `whatsapp`. Meta envía los
mensajes a `/api/webhooks/whatsapp/<connectionId>` (verificación con nuestro
token y firma `X-Hub-Signature-256` con el secreto de la app); se encolan como
`inbound_events` (`source: "whatsapp"`) del proyecto cuyo agente inbound
atiende ese número (`channels.whatsappId`) y siguen el mismo camino que
formularios y emails. Las respuestas son `whatsapp.send` en el gateway
(saliente: horario, exclusiones y enfriamientos por teléfono). Fuera de las 24
horas desde el último mensaje del contacto, Meta exige plantillas aprobadas
(pendiente).

## Conversaciones (bandeja)

`/app/conversations` (todas) y la pestaña Conversaciones de cada proyecto
(filtrada) son la misma bandeja (`server/conversations/inbox.ts`,
`app/app/conversations/inbox-view.tsx`):

- **Una fila por persona**: las conversaciones de una persona (una por canal
  o hilo: email, WhatsApp, formulario) se juntan en un solo hilo ordenado por
  fecha, también entre proyectos. La persona se reconoce por su email
  (`e:<email>`), si no por su teléfono (`t:<cifras>`), si no por su contacto
  (`c:<id>`); una conversación sin contacto es su propia fila (`conv:<id>`).
  La pestaña de un proyecto muestra solo su parte; las respuestas salen desde
  el proyecto de su última conversación.
- **Bandejas**: «Te necesitan» (algo por aprobar, o alguna conversación
  `open`, `waiting_us` o `handed_off`), «Esperando» (`waiting_customer`),
  «Cerradas» y «Todas»; filtros por canal y proyecto y búsqueda.
- **No leídas** por persona y usuario (`conversation_reads`): un mensaje del
  cliente posterior a la última vez que la abrió.
- **Borradores en el hilo**: las acciones `pending_approval` cuyo
  `context.subjectRef` es una de sus conversaciones se aprueban (editadas o
  no) o descartan ahí mismo, con las mismas acciones que «Por aprobar».
- **Responder** (`replyToPerson`): email o WhatsApp desde la identidad del
  proyecto, por el gateway como persona (reglas, exclusiones y horario se
  aplican). Lo enviado se guarda en el hilo (`recordActionInConversation`,
  ahora también WhatsApp). WhatsApp solo admite texto libre en las 24 h
  siguientes a su último mensaje; fuera de esa ventana no se ofrece.
- **Plantillas de WhatsApp**: pasadas 24 h desde su último WhatsApp (o si
  nunca escribió por ahí) solo se ofrecen las plantillas aprobadas de la
  cuenta (`whatsapp.list_templates`, necesita el identificador de la cuenta
  de WhatsApp Business en la conexión). Se envían como `whatsapp.send` con
  `template` (nombre, idioma, parámetros); `body` es su texto con los huecos
  rellenos, que es lo que queda en el hilo y lo que revisan las reglas.
- **Primeros emails de prospección**: cada uno abre una conversación con la
  persona de la fila (contacto del proyecto con `data.prospect` = tabla y
  fila); al enviarse, la conversación guarda el hilo de Gmail. La fila enlaza
  a su conversación («Ver la conversación») y la ficha, a su fila. Si las
  reglas lo bloquean, no queda conversación.
- **Respuestas en nuestros hilos** (`pollMailboxes`): cualquier buzón con
  permiso de lectura asignado a un proyecto trae las respuestas a hilos de
  email nuestros (de los últimos 90 días) directamente a su conversación
  (`waiting_us`, contacto `engaged`), aunque no haya agente inbound; un buzón
  que un agente lee para leads, además, encola todo lo nuevo como antes. El
  agente inbound del proyecto, si está activo, puede responderlas.
- **Tomar el control** pone sus conversaciones en `handed_off`: el agente
  inbound sigue guardando lo que llega pero no responde (el evento queda
  `processed`, resultado `handed_off`). «Devolver al agente» las deja `open`.
  También se cierran y reabren.
- **Notas internas**: mensajes `direction: internal`, canal `note`; no
  cuentan como último mensaje ni los ve el cliente.
- La página se refresca sola cada 15 s mientras está visible. La antigua
  página de una conversación redirige a la bandeja con esa persona abierta.

## Rendimiento

- Las funciones de Vercel corren en `fra1` (`vercel.json`), junto a Neon
  (`aws-eu-central-1`): cada consulta son varios viajes de ida y vuelta, y
  desde `iad1` cada uno costaba ~90 ms.
- `withTenant` fija la organización y el rol en una sola sentencia
  (`set_config('app.org_id')` y `set_config('role')`, locales a la transacción).
- Better Auth guarda la sesión firmada en una cookie 5 minutos
  (`session.cookieCache`): la mayoría de peticiones no la leen de la base de datos.
- Las sesiones abiertas (Mi cuenta → Seguridad) se leen y cierran directamente
  en la tabla `session` (`listOwnSessions`, `revokeOtherOwnSessions` en
  `auth/session.ts`): `listSessions` de Better Auth exige una sesión «fresca»
  (menos de un día) y fallaba con `SESSION_NOT_FRESH`.
- El menú lateral cuenta lo pendiente de aprobar con un `count` por proyecto,
  no listando las acciones.

## Personas de la organización

Configuración → Usuarios (`services/team.ts`, sobre las tablas `member` e
`invitation` de Better Auth). Propietarios y administradores invitan por
email con un rol; la invitación es un enlace (`/invite/<id>`, el id es el
secreto, 7 días) que se copia y se envía: no hay correo transaccional.
Quien lo abre se registra o entra con ese email (`?next=` lleva de vuelta)
y se une con un clic; en el onboarding también ve las invitaciones a su
email. Invitar de nuevo al mismo email anula el enlace anterior. Solo un
propietario da o quita el rol de propietario, siempre queda al menos uno y
nadie se quita a sí mismo. Todo queda en auditoría (`member.*`).

## Pendiente

- Enviar prospectos al CRM o a una secuencia de emails (con aprobación).
- Que el agente proponga el seguimiento (email, tarea) a partir de los
  siguientes pasos de una reunión.
- Exportaciones que actualicen una tabla ya exportada (hoy cada una crea otra).
- Account Manager (fase 3).
- Gmail push (Pub/Sub) para responder en segundos también por email.
- Worker de workflows durables (Inngest/Trigger.dev) en lugar del cron simple.
- Embeddings (pgvector) para complementar la búsqueda de texto completo.
