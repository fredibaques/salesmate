import { Suspense } from "react";
import { env } from "@/server/env";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Entrar" };

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm mode="sign-in" googleEnabled={Boolean(env().GOOGLE_CLIENT_ID)} />
    </Suspense>
  );
}
