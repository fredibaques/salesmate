import { Mail, User } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { requireTenant } from "@/server/auth/session";
import { updateProfile } from "./actions";

export const metadata = { title: "Mi cuenta" };

export default async function ProfilePage() {
  const tenant = await requireTenant();
  return (
    <Card title="Perfil">
      <div className="mb-6 flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-100 text-xl font-semibold text-accent">
          {(tenant.user.name || tenant.user.email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{tenant.user.name}</p>
          <p className="truncate text-sm text-muted">{tenant.user.email}</p>
        </div>
      </div>
      <ActionForm key={tenant.user.name} action={updateProfile} submitLabel="Guardar" className="space-y-4">
        <Field
          label="Nombre"
          tip="Así te ven las demás personas de tu organización en la auditoría y en las aprobaciones."
        >
          <Input
            name="name"
            defaultValue={tenant.user.name}
            required
            minLength={2}
            icon={<User />}
            autoComplete="name"
          />
        </Field>
        <Field label="Email" hint="Es con el que entras. Para cambiarlo, escríbenos.">
          <Input value={tenant.user.email} disabled icon={<Mail />} />
        </Field>
      </ActionForm>
    </Card>
  );
}
