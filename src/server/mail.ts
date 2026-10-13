import { env } from "./env";

/**
 * SalesMate's own emails (invitations to an organization), sent through
 * Resend. They are not actions of a project, so they don't go through the
 * gateway: what agents send to contacts always does.
 */

export type SystemEmail = { to: string; subject: string; text: string; html: string };

export function mailConfigured(): boolean {
  return Boolean(env().RESEND_API_KEY && env().EMAIL_FROM);
}

export async function sendSystemEmail(email: SystemEmail, fetchFn: typeof fetch = fetch): Promise<void> {
  const { RESEND_API_KEY, EMAIL_FROM } = env();
  if (!RESEND_API_KEY || !EMAIL_FROM) throw new Error("El envío de emails no está configurado.");
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Resend respondió ${res.status}.`);
  }
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The invitation to join an organization, with its link. */
export function invitationEmail(input: {
  to: string;
  inviter: string;
  organization: string;
  link: string;
  days: number;
}): SystemEmail {
  const subject = `${input.inviter} te invita a ${input.organization} en SalesMate`;
  const text = [
    `${input.inviter} te ha invitado a unirte a ${input.organization} en SalesMate.`,
    "",
    `Acepta la invitación aquí: ${input.link}`,
    "",
    `Entra o regístrate con este email (${input.to}). El enlace caduca en ${input.days} días.`,
  ].join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:480px">
<p><strong>${escape(input.inviter)}</strong> te ha invitado a unirte a <strong>${escape(input.organization)}</strong> en SalesMate.</p>
<p><a href="${escape(input.link)}" style="display:inline-block;background:#84cc16;color:#1a1a1a;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Aceptar la invitación</a></p>
<p style="color:#666;font-size:13px">Entra o regístrate con este email (${escape(input.to)}). El enlace caduca en ${input.days} días.<br>Si el botón no funciona, copia esta dirección: ${escape(input.link)}</p>
</div>`;
  return { to: input.to, subject, text, html };
}
