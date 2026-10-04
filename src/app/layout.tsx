import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SalesMate", template: "%s · SalesMate" },
  description: "Agentes de IA que ven tu información comercial y ejecutan tus procesos de venta.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
