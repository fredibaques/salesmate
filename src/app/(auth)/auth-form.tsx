"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Mail, User } from "lucide-react";
import { Logo } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { buttonClass, cx, Field, Input } from "@/components/ui";
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

  return (
    <div className="mx-auto mt-24 w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-sm">
      <Logo size={36} className="mb-5" />
      <h1 className="text-xl font-semibold">{mode === "sign-in" ? "Entrar en SalesMate" : "Crear cuenta"}</h1>
      <form action={onSubmit} className="mt-6 space-y-4">
        {mode === "sign-up" ? (
          <Field label="Nombre">
            <Input name="name" required autoComplete="name" icon={<User />} />
          </Field>
        ) : null}
        <Field label="Email">
          <Input name="email" type="email" required autoComplete="email" icon={<Mail />} />
        </Field>
        <Field label="Contraseña" hint={mode === "sign-up" ? "Al menos 10 caracteres." : undefined}>
          <PasswordInput
            name="password"
            required
            minLength={10}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          />
        </Field>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <button disabled={pending} className={buttonClass({ variant: "primary", size: "lg", block: true })}>
          {pending ? "Un momento…" : mode === "sign-in" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
      {googleEnabled ? (
        <button
          onClick={() => authClient.signIn.social({ provider: "google", callbackURL: next })}
          className={cx(buttonClass({ variant: "secondary", size: "lg", block: true }), "mt-3")}
        >
          Continuar con Google
        </button>
      ) : null}
      <p className="mt-4 text-center text-sm text-muted">
        {mode === "sign-in" ? (
          <>
            ¿No tienes cuenta?{" "}
            <Link href="/sign-up" className="text-accent hover:underline">
              Regístrate
            </Link>
          </>
        ) : (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link href="/sign-in" className="text-accent hover:underline">
              Entra
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
