import { Suspense } from "react";
import { env } from "@/server/env";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Crear cuenta" };

export default function SignUpPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-up" googleEnabled={Boolean(env().GOOGLE_CLIENT_ID)} />
    </Suspense>
  );
}
