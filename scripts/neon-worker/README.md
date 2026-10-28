# Worker de agentes (Neon Function)

Ejecuta los agentes junto a la base de datos, en una Neon Function
(`salesmateagents`), para que los minutos que pasan esperando al modelo no
corran en Vercel. La app le pasa cada trabajo (`dispatchJob`, en
`src/server/jobs`) y responde al momento; el worker lo ejecuta después, hasta
15 minutos. Si no hay worker configurado o no responde, el trabajo se hace en
la propia app, como antes.

También atiende los disparadores programados de Neon: cada llamada ejecuta
las tres pasadas del programador (`inbound`, `agents`, `release-deferred`).

## Variables

En el worker (Neon), las mismas que el servidor de la app más la clave compartida:

- `DATABASE_URL`, `ENCRYPTION_KEY`, `APP_URL`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JINA_API_KEY` (si se usan)
- `WORKER_SECRET`: `openssl rand -hex 32`

En la app (Vercel): `WORKER_URL` (la `invocation_url` de la función) y el
mismo `WORKER_SECRET`.

## Desplegar

El workflow `Deploy worker` lo construye y despliega solo en cada push a
`main` que toque el servidor (o a mano, desde Actions). Necesita en GitHub el
secreto `NEON_API_KEY` (una API key de Neon); el proyecto y la rama son los de
producción salvo que se fijen las variables `NEON_PROJECT_ID` y `NEON_BRANCH_ID`.
Despliega solo el código: las variables se quedan como estén en Neon.

A mano:

```bash
pnpm worker:build   # dist/neon-worker/function.zip
curl -X POST "https://console.neon.tech/api/v2/projects/$PROJECT/branches/$BRANCH/functions/salesmateagents/deployments" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -F "zip=@dist/neon-worker/function.zip" \
  -F 'environment={"DATABASE_URL":"…","ENCRYPTION_KEY":"…","WORKER_SECRET":"…"}'
```

El primer despliegue lleva el zip y las variables; los siguientes, solo el zip.

## Programador

Los disparadores `dia` (`*/15 5-20 * * *`) y `noche` (`0 0-4,21-23 * * *`)
llaman a `salesmateagents`. Mientras sigan sobre `salesmatecron`
(`scripts/neon-scheduler`), también funciona: la app pasa cada pasada al worker.
