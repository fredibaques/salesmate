import { Tabs, TabLink } from "@/components/nav-link";
import { PageHeader } from "@/components/ui";

/** Organization-wide settings: connected tools, exclusions and the audit log. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader className="mb-4" title="Configuración" />
      <Tabs>
        <TabLink href="/app/connections">Conexiones</TabLink>
        <TabLink href="/app/exclusions">Exclusiones</TabLink>
        <TabLink href="/app/audit">Auditoría</TabLink>
      </Tabs>
      {children}
    </>
  );
}
