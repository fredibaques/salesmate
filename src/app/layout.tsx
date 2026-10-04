import type { Metadata } from "next";
import { connection } from "next/server";
import { configProblems } from "@/server/env";
import { ConfigError } from "./config-error";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SalesMate", template: "%s · SalesMate" },
  description: "Agentes de IA que ven tu información comercial y ejecutan tus procesos de venta.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Misconfiguration shows a readable page instead of a 500 on every route.
  // Checked per request, not at build time, so prerendered pages pick up env changes.
  await connection();
  const problems = configProblems();
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">
        {problems.length ? <ConfigError problems={problems} /> : children}
      </body>
    </html>
  );
}
