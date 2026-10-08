import { ActionForm } from "@/components/action-form";
import { Logo } from "@/components/logo";
import { buttonClass, Notice } from "@/components/ui";
import Link from "next/link";
import { getSession } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getInvitation } from "@/server/services/team";
import { acceptInvitationAction } from "./actions";

export const metadata = { title: "Invitación" };

const ROLE_NAMES = { owner: "propietario", admin: "administrador", member: "miembro" } as const;

/**
 * An invitation link: who invites, to which organization and with what
 * role. Without a session it sends to sign up or sign in (and back here);
 * with the invited email's session, one click joins.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[id]">) {
  const { id } = await params;
  const [invitation, session] = await Promise.all([getInvitation(getDb(), id), getSession()]);
  const back = encodeURIComponent(`/invite/${id}`);

  let body;
  if (!invitation || invitation.problem === "used") {
    body = <Notice tone="warning">Esta invitación ya no es válida. Pide que te inviten de nuevo.</Notice>;
  } else if (invitation.problem === "expired") {
    body = <Notice tone="warning">Esta invitación ha caducado. Pide que te inviten de nuevo.</Notice>;
  } else if (!session) {
    const email = encodeURIComponent(invitation.email);
    body = (
      <div className="space-y-3">
        <Link
          href={`/sign-up?next=${back}&email=${email}`}
          className={buttonClass({ variant: "primary", size: "lg", block: true })}
        >
          Crear mi cuenta
        </Link>
        <Link
          href={`/sign-in?next=${back}&email=${email}`}
          className={buttonClass({ variant: "secondary", size: "lg", block: true })}
        >
          Ya tengo cuenta
        </Link>
      </div>
    );
  } else if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    body = (
      <Notice tone="warning">
        Has entrado como {session.user.email}, pero la invitación es para {invitation.email}. Cierra la sesión
        y entra con esa cuenta.
      </Notice>
    );
  } else {
    body = (
      <ActionForm
        action={acceptInvitationAction.bind(null, invitation.id)}
        submitLabel={`Unirme a ${invitation.organizationName}`}
        className="flex flex-wrap items-center gap-3"
      />
    );
  }

  return (
    <div className="mx-auto mt-24 w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
      <Logo size={36} className="mb-5" />
      <h1 className="text-xl font-semibold">
        {invitation ? `Únete a ${invitation.organizationName}` : "Invitación"}
      </h1>
      {invitation && !invitation.problem ? (
        <p className="mt-2 text-sm text-muted">
          {invitation.inviterName} te invita a SalesMate como {ROLE_NAMES[invitation.role]}, con el email{" "}
          <span className="font-medium text-foreground">{invitation.email}</span>.
        </p>
      ) : null}
      <div className="mt-6">{body}</div>
    </div>
  );
}
