import { Search } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { ModalButton } from "@/components/modal";
import { Field, Input } from "@/components/ui";
import { DEFAULT_FIND_PER_RUN, MAX_FIND_PER_RUN } from "@/server/agents/prospector";
import type { AgentSettings } from "@/server/db/schema";
import { runProspectingNow } from "./actions";

/**
 * «Buscar ahora» of a prospecting agent: asks how many new rows to look
 * for (the agent's number by default). An agent that only completes cells
 * starts right away.
 */
export function FindNowButton({
  projectId,
  agentId,
  settings,
  back,
  label = "Buscar ahora",
}: {
  projectId: string;
  agentId: string;
  settings: AgentSettings;
  /** Page to go back to, which then follows the run. */
  back: string;
  label?: string;
}) {
  const action = runProspectingNow.bind(null, projectId, agentId);
  if (settings.mode === "complete") {
    return (
      <ActionForm action={action} submitLabel={label} submitVariant="secondary" className="flex items-center">
        <input type="hidden" name="back" value={back} />
      </ActionForm>
    );
  }
  return (
    <ModalButton label={label} icon={<Search className="size-4" />} title={label} variant="secondary">
      <ActionForm action={action} submitLabel="Empezar a buscar" className="space-y-4">
        <input type="hidden" name="back" value={back} />
        <Field
          label="Filas nuevas que quieres"
          tip={`Si en una ejecución no le da tiempo, sigue sola en las siguientes hasta conseguirlas (o hasta el límite de gasto del mes). Como mucho ${MAX_FIND_PER_RUN}.`}
        >
          <Input
            name="wanted"
            type="number"
            min={1}
            max={MAX_FIND_PER_RUN}
            required
            defaultValue={settings.findPerRun ?? DEFAULT_FIND_PER_RUN}
            className="w-40"
          />
        </Field>
      </ActionForm>
    </ModalButton>
  );
}
