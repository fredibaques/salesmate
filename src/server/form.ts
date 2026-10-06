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

/** The chips of a `ChipSelect` plus its comma-separated «Otros» field. */
export function listWithOther(form: FormData, key: string): string[] {
  const other = (str(form, `${key}Other`) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set([...list(form, key), ...other])];
}

/** Rows of a `PairListInput`: both values of each row, dropping rows with an empty side. */
export function pairs(form: FormData, first: string, second: string): [string, string][] {
  const a = form.getAll(first).map((v) => String(v).trim());
  const b = form.getAll(second).map((v) => String(v).trim());
  return a.flatMap((x, i) => (x && b[i] ? [[x, b[i]] as [string, string]] : []));
}
