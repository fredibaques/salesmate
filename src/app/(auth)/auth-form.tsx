"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode, googleEnabled }: { mode: "sign-in" | "sign-up"; googleEnabled: boolean }) {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/app";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(form: FormData) {
    setPending(true);
    setError(null);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "") });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "No se ha podido completar la operación.");
      return;
    }
    router.push(mode === "sign-up" ? "/onboarding" : next);
    router.refresh();
  }

  const input =
    "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  return (
    <div className="mx-auto mt-24 w-full max-w-sm rounded-xl border border-border bg-surface p-6">
      <h1 className="text-xl font-semibold">{mode === "sign-in" ? "Entrar en SalesMate" : "Crear cuenta"}</h1>
      <form action={onSubmit} className="mt-6 space-y-3">
        {mode === "sign-up" ? <input name="name" required placeholder="Nombre" className={input} /> : null}
        <input
          name="email"
          type="email"
          required
          placeholder="Email"
          autoComplete="email"
          className={input}
        />
        <input
          name="password"
          type="password"
          required
          minLength={10}
          placeholder="Contraseña (mín. 10 caracteres)"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          className={input}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button
          disabled={pending}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
        >
          {pending ? "…" : mode === "sign-in" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
      {googleEnabled ? (
        <button
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
          className="mt-3 w-full rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-background"
        >
          Continuar con Google
        </button>
      ) : null}
      <p className="mt-4 text-center text-sm text-muted">
        {mode === "sign-in" ? (
          <>
            ¿No tienes cuenta?{" "}
            <Link href="/sign-up" className="text-accent">
              Regístrate
            </Link>
          </>
        ) : (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link href="/sign-in" className="text-accent">
              Entra
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
