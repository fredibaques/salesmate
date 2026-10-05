import { ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Avatar, Badge, PageHeader } from "@/components/ui";
import { INTEGRATION_CATEGORIES, INTEGRATIONS, type IntegrationCategory } from "@/lib/integrations";
import { requireTenant } from "@/server/auth/session";

export const metadata = { title: "Añadir conexión" };

export default async function NewConnectionPage() {
  await requireTenant();
  const categories = Object.keys(INTEGRATION_CATEGORIES) as IntegrationCategory[];

  return (
    <>
      <Link
        href="/app/connections"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Conexiones
      </Link>
      <PageHeader
        title="Añadir conexión"
        description="Elige la herramienta que quieres conectar. Puedes conectar varias cuentas de la misma, por ejemplo un Google para cada empresa."
      />
      <div className="space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold text-muted">{INTEGRATION_CATEGORIES[category]}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {INTEGRATIONS.filter((i) => i.category === category).map((i) =>
                i.status === "available" ? (
                  <Link
                    key={i.id}
                    href={`/app/connections/new/${i.id}`}
                    className="group flex items-center gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-accent/50 hover:shadow-sm"
                  >
                    <Avatar label={i.name} color={i.color} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{i.name}</span>
                      <span className="block text-sm text-muted">{i.tagline}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                  </Link>
                ) : (
                  <div
                    key={i.id}
                    aria-disabled
                    className="flex items-center gap-3 rounded-xl border border-dashed border-border p-4"
                  >
                    <Avatar label={i.name} color={i.color} className="opacity-50" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium opacity-70">{i.name}</span>
                        <Badge>Próximamente</Badge>
                      </span>
                      <span className="block text-sm text-muted opacity-70">{i.tagline}</span>
                    </span>
                  </div>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
