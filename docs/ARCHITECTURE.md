# Arquitectura (fase 0)

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

- **Tablas** (CSV/XLSX): tipado automático (números en formato español o
  inglés, fechas, booleanos) y consulta estructurada con parámetros (`queryTable`).
- **Documentos** (PDF, DOCX, Markdown, HTML, texto): fragmentos por párrafo y
  búsqueda de texto completo sin acentos con citas (`searchKnowledge`).
- Cada fuente es *fuente de verdad* u *orientativa*; el gateway solo acepta
  cifras en mensajes salientes si citan una fuente de verdad.

## Pendiente para la fase 1

- Capa LLM (Claude) y copiloto que use `queryTable` / `searchKnowledge` como herramientas.
- Playbooks y Agente Inbound (procesando `inbound_events` y el correo).
- Worker de workflows durables (Inngest/Trigger.dev) en lugar del cron simple.
- Embeddings (pgvector) para complementar la búsqueda de texto completo.
