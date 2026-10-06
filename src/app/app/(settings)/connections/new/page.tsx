import { Avatar, Badge, CardGrid, EntityCard, PageHeader } from "@/components/ui";
import { INTEGRATION_CATEGORIES, INTEGRATIONS, type IntegrationCategory } from "@/lib/integrations";
import { requireTenant } from "@/server/auth/session";

export const metadata = { title: "Añadir conexión" };

export default async function NewConnectionPage() {
  await requireTenant();
  const categories = Object.keys(INTEGRATION_CATEGORIES) as IntegrationCategory[];

  return (
    <>
      <PageHeader
        level="section"
        title="Añadir conexión"
      />
      <div className="space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold text-muted">{INTEGRATION_CATEGORIES[category]}</h2>
            <CardGrid>
              {INTEGRATIONS.filter((i) => i.category === category).map((i) => (
                <EntityCard
                  key={i.id}
                  href={i.status === "available" ? `/app/connections/new/${i.id}` : undefined}
                  variant={i.status === "available" ? "default" : "disabled"}
                  media={<Avatar label={i.name} color={i.color} />}
                  title={i.name}
                  badge={i.status === "available" ? null : <Badge>Próximamente</Badge>}
                  description={i.tagline}
                />
              ))}
            </CardGrid>
          </section>
        ))}
      </div>
    </>
  );
}
