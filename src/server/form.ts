import { ZodError } from "zod";
import type { FormState } from "@/components/action-form";

/** Runs a mutation for a form and converts errors into a readable message. */
export async function runForm(fn: () => Promise<string | void>, okMessage = "Guardado."): Promise<FormState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? okMessage };
  } catch (err) {
    if (isRedirect(err)) throw err;
    if (err instanceof ZodError) {
      return {
        ok: false,
        message: err.issues.map((i) => `${i.path.join(".") || "dato"}: ${i.message}`).join(" · "),
      };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function isRedirect(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    String((err as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

export function str(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

export function num(form: FormData, key: string): number | undefined {
  const v = str(form, key);
  return v === undefined ? undefined : Number(v);
}

export function list(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
}

export function bool(form: FormData, key: string): boolean {
  return form.get(key) === "on" || form.get(key) === "true";
}
