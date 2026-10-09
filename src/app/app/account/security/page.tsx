import { Laptop, Smartphone } from "lucide-react";
import { headers } from "next/headers";
import { ActionForm } from "@/components/action-form";
import { PasswordInput } from "@/components/password-input";
import { Badge, Card, Choice, Field, Notice } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getAuth } from "@/server/auth/auth";
import { getSession, listOwnSessions, requireTenant } from "@/server/auth/session";
import { changePassword, signOutOtherSessions } from "../actions";

export const metadata = { title: "Seguridad" };

/** «Chrome en macOS» from a user agent, good enough to recognise a device. */
function describeDevice(userAgent: string | null | undefined) {
  if (!userAgent) return { label: "Dispositivo desconocido", mobile: false };
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Navegador";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "otro sistema";
  return { label: `${browser} en ${os}`, mobile: /Mobile|iPhone|Android/.test(userAgent) };
}

export default async function SecurityPage() {
  const tenant = await requireTenant();
  const h = await headers();
  // Read straight from the store: Better Auth's listSessions asks for a
  // login from the last day («fresh» session), which a page to look at your
  // own devices shouldn't.
  const [current, sessions, accounts] = await Promise.all([
    getSession(),
    listOwnSessions(tenant.userId),
    getAuth().api.listUserAccounts({ headers: h }),
  ]);
  const hasPassword = accounts.some((a) => a.providerId === "credential");
  const others = sessions.filter((s) => s.id !== current?.session.id);

  return (
    <>
      <Card title="Contraseña">
        {hasPassword ? (
          <ActionForm action={changePassword} submitLabel="Cambiar contraseña" className="space-y-4">
            <Field label="Contraseña actual">
              <PasswordInput name="currentPassword" required autoComplete="current-password" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nueva contraseña" hint="Al menos 10 caracteres.">
                <PasswordInput name="newPassword" required minLength={10} autoComplete="new-password" />
              </Field>
              <Field label="Repite la nueva">
                <PasswordInput name="confirmPassword" required minLength={10} autoComplete="new-password" />
              </Field>
            </div>
            <Choice name="revokeOthers" defaultChecked label="Cerrar la sesión en los demás dispositivos" />
          </ActionForm>
        ) : (
          <Notice>Entras con tu cuenta de Google, así que no tienes contraseña en SalesMate.</Notice>
        )}
      </Card>

      <Card
        title="Sesiones abiertas"
        tip="Dispositivos donde has entrado y no has salido. Si no reconoces alguno, cierra las demás sesiones y cambia la contraseña."
      >
        <ul className="divide-y divide-border">
          {[...sessions]
            .sort((a, b) => (a.id === current?.session.id ? -1 : b.id === current?.session.id ? 1 : 0))
            .map((s) => {
              const device = describeDevice(s.userAgent);
              const Icon = device.mobile ? Smartphone : Laptop;
              return (
                <li key={s.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-background text-muted">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{device.label}</p>
                    <p className="text-xs text-muted">
                      Última actividad {formatDateTime(s.updatedAt)}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                    </p>
                  </div>
                  {s.id === current?.session.id ? <Badge tone="success">Esta sesión</Badge> : null}
                </li>
              );
            })}
        </ul>
        {others.length > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <ActionForm
              action={signOutOtherSessions}
              submitLabel="Cerrar las demás sesiones"
              submitVariant="secondary"
              confirm="¿Cerrar la sesión en todos los demás dispositivos?"
            />
          </div>
        ) : null}
      </Card>
    </>
  );
}
