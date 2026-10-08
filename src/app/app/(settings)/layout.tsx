import { Tabs, TabLink } from "@/components/nav-link";
import { SectionChrome } from "@/components/section-chrome";
import { PageHeader } from "@/components/ui";

/** Organization-wide settings: the AI account, users, exclusions and the audit log. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SectionChrome>
        <PageHeader className="mb-4" title="Configuración" />
        <Tabs>
          <TabLink href="/app/ai">IA</TabLink>
          <TabLink href="/app/users">Usuarios</TabLink>
          <TabLink href="/app/exclusions">Exclusiones</TabLink>
          <TabLink href="/app/audit">Auditoría</TabLink>
        </Tabs>
      </SectionChrome>
      {children}
    </>
  );
}
