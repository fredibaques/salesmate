export function ConfigError({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Falta configurar SalesMate</h1>
      <p className="mt-2 text-sm text-muted">
        Añade estas variables de entorno en tu proveedor de hosting (en Vercel: Settings → Environment Variables) y
        vuelve a desplegar.
      </p>
      <ul className="mt-6 space-y-2 text-sm">
        {problems.map((p) => (
          <li key={p} className="rounded-lg border border-danger/30 bg-danger/5 p-3">
            {p}
          </li>
        ))}
      </ul>
    </main>
  );
}
