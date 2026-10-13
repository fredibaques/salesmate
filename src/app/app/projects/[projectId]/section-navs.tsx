import { SubTabLink, SubTabs } from "@/components/nav-link";

/**
 * Configuración: the project's data, what it's for and who it's for, how its
 * agents sell, and the rules every action is checked against.
 */
export function ConfigNav({ projectId }: { projectId: string }) {
  const base = `/app/projects/${projectId}`;
  return (
    <SubTabs>
      <SubTabLink href={`${base}/settings`}>General</SubTabLink>
      <SubTabLink href={`${base}/sales`}>Objetivo y público</SubTabLink>
      <SubTabLink href={`${base}/sales/process`}>Proceso de venta</SubTabLink>
      <SubTabLink href={`${base}/rules`}>Reglas y exclusiones</SubTabLink>
    </SubTabs>
  );
}
