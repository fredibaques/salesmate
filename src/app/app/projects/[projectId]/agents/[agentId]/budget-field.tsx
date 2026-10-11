import { Field, FormSection, Input } from "@/components/ui";

/**
 * The agent's only spending limit, the same on every agent: what it may
 * spend in a month. Its runs stop when they reach it (keeping what they
 * saved) and none starts again until next month.
 */
export function MonthlyBudgetField({ value, spent }: { value?: number; spent: number }) {
  return (
    <FormSection
      title="Gasto"
      tip="Lo que cuesta la IA y las búsquedas de este agente. Es su único límite: dentro de él trabaja todo lo que haga falta."
    >
      <Field
        label="Gasto máximo al mes ($)"
        optional
        hint={`Este mes lleva ${spent.toFixed(2)} $. Vacío: sin límite.`}
        tip="Al llegar, termina lo que estaba haciendo (guardando lo que tiene) y no vuelve a trabajar hasta el mes que viene."
      >
        <Input
          name="maxCostPerMonthUsd"
          inputMode="decimal"
          defaultValue={value}
          placeholder="p. ej. 30"
          className="w-40"
        />
      </Field>
    </FormSection>
  );
}
