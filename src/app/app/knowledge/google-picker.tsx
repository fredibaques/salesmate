"use client";

import { Search } from "lucide-react";
import Link from "@/components/link";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import type { FormState } from "@/components/action-form";
import { IntegrationLogo } from "@/components/integration-logo";
import { useToast } from "@/components/toast";
import { Badge, buttonClass, Input, Notice } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { DriveFile } from "@/server/knowledge/google-import";

type Listing = { files: DriveFile[]; connected: boolean; reconnect: boolean; error?: string };

/**
 * The Docs and Sheets of the connected Google accounts, newest first, with a
 * search by name: one click imports a copy into this knowledge. A file that
 * isn't listed can still be imported by its link (`children`).
 */
export function GoogleDrivePicker({
  list,
  importFile,
  children,
}: {
  list: (query: string) => Promise<Listing>;
  importFile: (file: { url: string; name: string }) => Promise<FormState>;
  children: ReactNode;
}) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [imported, setImported] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();

  // A short pause after typing before asking Google again.
  useEffect(() => {
    const timer = setTimeout(
      () => {
        list(query)
          .then(setListing)
          .catch(() =>
            setListing({
              files: [],
              connected: true,
              reconnect: false,
              error: "No se ha podido cargar la lista.",
            }),
          );
      },
      query ? 400 : 0,
    );
    return () => clearTimeout(timer);
  }, [query, list]);

  const pick = (f: DriveFile) => {
    setBusy(f.id);
    start(async () => {
      const result = await importFile({ url: f.url, name: f.name });
      setBusy(null);
      if (result?.ok) setImported((ids) => [...ids, f.id]);
      toast?.({ ok: Boolean(result?.ok), message: result?.message ?? "" });
    });
  };

  return (
    <div className="space-y-4">
      {listing && !listing.connected ? (
        <Notice tone="warning">
          Conecta Google Docs o Google Sheets para ver aquí tus archivos.{" "}
          <Link href="/app/connections?add=google_docs" className="text-accent hover:underline">
            Conectar
          </Link>
        </Notice>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre"
            aria-label="Buscar en Google Drive"
            icon={<Search />}
          />
          {listing?.reconnect ? (
            <Notice>
              Una de tus cuentas de Google se conectó antes de poder listar archivos: vuelve a conectar Google
              Docs o Sheets en Integraciones para ver los suyos.
            </Notice>
          ) : null}
          {listing?.error ? <Notice tone="danger">{listing.error}</Notice> : null}
          {!listing ? (
            <p className="py-6 text-center text-sm text-muted">Cargando tus archivos…</p>
          ) : listing.files.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {query ? "Ningún documento ni hoja se llama así." : "No hay documentos ni hojas que mostrar."}
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {listing.files.map((f) => {
                const done = imported.includes(f.id);
                return (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-ink-50">
                    <IntegrationLogo
                      id={f.kind === "doc" ? "google_docs" : "google_sheets"}
                      name={f.kind === "doc" ? "Docs" : "Sheets"}
                      size="xs"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {f.kind === "doc" ? "Documento" : "Hoja de cálculo"}
                        {f.modifiedAt ? ` · ${formatDate(new Date(f.modifiedAt))}` : ""} · {f.account}
                      </span>
                    </span>
                    {done ? (
                      <Badge tone="success">Importado</Badge>
                    ) : (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => pick(f)}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {busy === f.id ? "Importando…" : "Importar"}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <details className="group rounded-lg border border-border">
        <summary className="cursor-pointer px-3 py-2 text-sm text-muted hover:text-foreground">
          ¿No está en la lista? Impórtalo con su enlace
        </summary>
        <div className="border-t border-border p-3">{children}</div>
      </details>
    </div>
  );
}
