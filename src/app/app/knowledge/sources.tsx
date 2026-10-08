import { ClipboardType, FileSpreadsheet, FileText, Presentation, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytes } from "@/lib/format";

type SourceLike = {
  kind: "document" | "table" | "live" | "examples";
  file: { filename: string; size: number } | null;
};

function extension(filename: string) {
  return filename.toLowerCase().split(".").pop() ?? "";
}

/** How a knowledge source is labelled and drawn everywhere in the app. */
export function describeSource(s: SourceLike): { icon: ReactNode; label: string; detail?: string } {
  const ext = s.file ? extension(s.file.filename) : "";
  const size = s.file ? formatBytes(s.file.size) : undefined;
  if (s.kind === "table") {
    return {
      icon: ext === "csv" || ext === "tsv" ? <Table2 /> : <FileSpreadsheet />,
      label: "Hoja de cálculo",
      detail: size,
    };
  }
  if (!s.file) return { icon: <ClipboardType />, label: s.kind === "examples" ? "Ejemplos" : "Texto" };
  if (ext === "pdf") return { icon: <Presentation />, label: "PDF", detail: size };
  if (ext === "docx") return { icon: <FileText />, label: "Word", detail: size };
  return { icon: <FileText />, label: ext.toUpperCase() || "Documento", detail: size };
}
