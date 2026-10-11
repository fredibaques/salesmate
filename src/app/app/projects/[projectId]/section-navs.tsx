import { SubTabLink, SubTabs } from "@/components/nav-link";

/** Ajustes: project data and the rules every action is checked against. */
export function SettingsNav({ projectId }: { projectId: string }) {
  const base = `/app/projects/${projectId}`;
  return (
    <SubTabs>
      <SubTabLink href={`${base}/settings`}>General</SubTabLink>
      <SubTabLink href={`${base}/rules`}>Reglas y exclusiones</SubTabLink>
    </SubTabs>
  );
}

/** Ventas: what the project is for and who it's for, and how its agents sell. */
export function SalesNav({ projectId }: { projectId: string }) {
  const base = `/app/projects/${projectId}/sales`;
  return (
    <SubTabs>
      <SubTabLink href={base}>Objetivo y público</SubTabLink>
      <SubTabLink href={`${base}/process`}>Proceso de venta</SubTabLink>
    </SubTabs>
  );
}
