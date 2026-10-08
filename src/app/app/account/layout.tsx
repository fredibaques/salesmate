import { TabLink, Tabs } from "@/components/nav-link";
import { PageHeader } from "@/components/ui";

/** The signed-in person's own settings: profile, security and their organization. */
export default function AccountLayout({ children }: LayoutProps<"/app/account">) {
  return (
    <>
      <PageHeader className="mb-4" title="Mi cuenta" />
      <Tabs>
        <TabLink href="/app/account" exact>
          Perfil
        </TabLink>
        <TabLink href="/app/account/security">Seguridad</TabLink>
        <TabLink href="/app/account/organization">Organización</TabLink>
        <TabLink href="/app/account/menu">Menú</TabLink>
      </Tabs>
      <div className="max-w-3xl space-y-6">{children}</div>
    </>
  );
}
