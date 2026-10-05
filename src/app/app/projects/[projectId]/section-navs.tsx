import { SubTabLink, SubTabs } from "@/components/nav-link";

/** Conocimiento: the documents the agents read and what the project sells, in one place. */
export function KnowledgeNav({ projectId }: { projectId: string }) {
  const base = `/app/projects/${projectId}`;
  return (
    <SubTabs>
      <SubTabLink href={`${base}/knowledge`}>Documentos y tablas</SubTabLink>
      <SubTabLink href={`${base}/offer`}>Oferta y cliente</SubTabLink>
    </SubTabs>
  );
}

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
