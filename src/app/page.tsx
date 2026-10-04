import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";

export default async function Home() {
  if (await getSession()) redirect("/app");
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6">
      <h1 className="text-4xl font-semibold tracking-tight">SalesMate</h1>
      <p className="mt-4 text-lg text-muted">
        Agentes de IA que ven la información comercial de cada uno de tus proyectos y ejecutan tus procesos de
        venta en las herramientas que ya usas, siempre con tu aprobación.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/sign-in"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground"
        >
          Entrar
        </Link>
        <Link href="/sign-up" className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
          Crear cuenta
        </Link>
      </div>
    </main>
  );
}
