# Programador (Neon Function)

Llama cada 15 minutos de día (5–20 UTC) y cada hora de noche a
`/api/cron/{inbound,agents,release-deferred}`. Las llamadas son idempotentes:
lo que ya se hizo no se repite, así que convive con el workflow de GitHub
Actions (respaldo, cada hora).

La app no guarda la clave de la función: solo su hash SHA-256, en la tabla
`scheduler_keys`, que el rol de la app no puede leer.

## Desplegar o rotar la clave

1. Genera una clave: `openssl rand -hex 32`.
2. Guarda su hash en la base de datos (SQL en Neon, como propietario):

   ```sql
   insert into scheduler_keys (name, key_hash)
   values ('neon', encode(sha256('<clave>'::bytea), 'hex'))
   on conflict (name) do update set key_hash = excluded.key_hash, created_at = now();
   ```

3. Despliega la función `salesmatecron` en la rama `main` (un zip con
   `index.mjs` en la raíz) con las variables `APP_URL` y `SCHEDULER_SECRET`
   (la clave):

   ```bash
   neon functions deploy salesmatecron --src scripts/neon-scheduler/index.mjs \
     --env APP_URL=https://salesmate-mu.vercel.app --env SCHEDULER_SECRET=… --wait
   ```

4. Dos disparadores de tipo `schedule` sobre `salesmatecron`:
   - `dia`: `*/15 5-20 * * *`
   - `noche`: `0 0-4,21-23 * * *`
