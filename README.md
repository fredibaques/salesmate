# SalesMate

Aplicación web multiproyecto con agentes de IA que **ven** la información
comercial de cada proyecto (CRM, documentos, tarifas, bases de datos, Excel…)
y **ejecutan** procesos de venta sobre sus herramientas (CRM, correo,
calendario, teléfono, WhatsApp…) vía API, MCP o navegador.

- **Agente Outbound**: prospección, investigación, outreach personalizado y seguimientos.
- **Agente Inbound**: respuesta inmediata, cualificación y conversión según el modelo de venta (reunión, presupuesto, pago, llamada…) con registro en el CRM.
- **Agente Account Manager**: clientes existentes; renovaciones, venta cruzada, reactivación y retención.
- **Agente de Inteligencia**: señales de compra, cuentas calientes y optimización.

Agnóstica de sector y de modelo de venta (B2B consultivo, B2B transaccional,
B2C asistido, B2C autoservicio). Diseñada para uso propio en varios proyectos y
para venderse como SaaS más adelante. Inspirado en [Alta](https://www.altahq.com/).

## Documentación

- [Plan de producto y técnico](docs/PLAN.md): visión, modelos de venta, agentes, roadmap.
- [Arquitectura](docs/ARCHITECTURE.md): cómo está construido el código de la fase 0.

## Estado

**Fase 0 (fundamentos) implementada.** Ver el detalle en
[§16 del plan](docs/PLAN.md#16-roadmap-por-fases).

| Pieza | Estado |
|---|---|
| Organizaciones (tenants), miembros y roles, con aislamiento por RLS en Postgres | ✅ |
| Proyectos con zona horaria, franja de envío, enfriamiento entre proyectos y botón de parada | ✅ |
| Action Gateway: validación, políticas, autonomía, aprobaciones, ejecución única y auditoría | ✅ |
| Bandeja de aprobaciones (editar, aprobar, rechazar, programadas, historial) | ✅ |
| Conectores: Twenty CRM (API + webhooks), Google (Gmail + Calendar) con OAuth | ✅ |
| Disponibilidad global entre calendarios y tipos de reunión por proyecto | ✅ |
| Conocimiento: Excel/CSV como tablas consultables, PDF/Word/Markdown con búsqueda y citas | ✅ |
| Reglas de cumplimiento por proyecto y exclusiones (globales y por proyecto) | ✅ |
| Copiloto / agentes con LLM | Fase 1 |

## Puesta en marcha

Requisitos: Node.js 20.9+ y pnpm.

```bash
pnpm install
cp .env.example .env.local
# Rellena BETTER_AUTH_SECRET y ENCRYPTION_KEY:
#   openssl rand -base64 32
pnpm dev
```

Abre http://localhost:3000, crea una cuenta y tu organización.

Por defecto se usa **Postgres embebido (PGlite)** guardado en `./.data`, sin
instalar nada; las migraciones se aplican solas al arrancar.

En producción usamos **Neon** (proyecto `SalesMate`, región Frankfurt). Copia
la cadena de conexión *pooled* desde la consola de Neon a `DATABASE_URL`,
quitando el parámetro `channel_binding` (el driver `postgres` no lo admite):
`postgresql://usuario:clave@ep-…-pooler.eu-central-1.aws.neon.tech/salesmate?sslmode=require`.
Las migraciones nuevas se aplican con `pnpm db:migrate`.

### Conectar herramientas

- **Twenty CRM**: en *Conexiones*, URL base (`https://api.twenty.com` o tu
  instancia) y una API key (*Settings → APIs & Webhooks*). Para recibir eventos,
  crea en Twenty un webhook hacia la URL que muestra SalesMate y guarda su secreto.
- **Google**: crea un cliente OAuth (tipo *Web application*) en Google Cloud,
  habilita Gmail API y Google Calendar API y añade como URIs de redirección
  `{APP_URL}/api/auth/callback/google` y `{APP_URL}/api/connections/google/callback`.
  Pon `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env.local`. Mientras la app
  no esté verificada por Google, añade tus cuentas como usuarios de prueba.
- **Acciones programadas**: las acciones fuera de horario se liberan llamando a
  `GET /api/cron/release-deferred` con `Authorization: Bearer $CRON_SECRET`.
  Lo hace el workflow `release-deferred` de GitHub Actions cada 30 minutos en
  horario laboral (configura los secretos `APP_URL` y `CRON_SECRET` del
  repositorio). Así la base de datos puede apagarse el resto del tiempo y el
  consumo cabe en el plan gratuito de Neon.

### Probar sin agentes

En *Bandeja → Probar el flujo de aprobación* puedes proponer una acción como si
la hubiera preparado un agente y ver cómo la tratan las reglas, la aprobación y
la ejecución.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo |
| `pnpm build` / `pnpm start` | Compilación y servidor de producción |
| `pnpm test` | Tests (Vitest, con Postgres embebido en memoria) |
| `pnpm typecheck` | Tipos (incluye los tipos de rutas de Next.js) |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Genera una migración a partir del esquema |
| `pnpm db:migrate` | Aplica las migraciones a `DATABASE_URL` |
