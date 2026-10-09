import { and, eq, or, sql } from "drizzle-orm";
import type { BaseColumn } from "@/lib/prospect-columns";
import { contacts, prospectBases, prospects, type CellMeta } from "../db/schema";
import type { Tx } from "../db/tenant";
import type { Lead } from "./conversations";

/**
 * The inbound agent's table: each person who writes in becomes a row of the
 * table it works on (or finds their row, by email or phone, if a prospecting
 * agent or a person already added it), linked to their contact so the row
 * opens their conversation.
 */
export async function recordLeadRow(
  tx: Tx,
  input: {
    orgId: string;
    baseId: string;
    agentConfigId: string;
    runId?: string;
    contactId: string;
    lead: Lead;
    now: Date;
  },
) {
  const [base] = await tx.select().from(prospectBases).where(eq(prospectBases.id, input.baseId));
  if (!base) return null;
  const { lead } = input;
  const email = lead.email?.toLowerCase() ?? null;
  const phone = lead.phone?.replace(/[^0-9+]/g, "") || null;
  const emailColumn = base.columns.find((c: BaseColumn) => c.type === "email");
  const phoneColumn = base.columns.find((c: BaseColumn) => c.type === "phone");

  const match = [
    email && emailColumn ? sql`lower(${prospects.data}->>${emailColumn.id}) = ${email}` : undefined,
    phone && phoneColumn
      ? sql`regexp_replace(coalesce(${prospects.data}->>${phoneColumn.id}, ''), '[^0-9+]', '', 'g') = ${phone}`
      : undefined,
    sql`${prospects.dedupeKey} = ${`lead:${email ?? phone}`}`,
  ].filter((c) => c !== undefined);
  const [existing] = await tx
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(eq(prospects.baseId, base.id), or(...match)))
    .limit(1);

  let rowId = existing?.id;
  if (!rowId) {
    const person = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;
    const data: Record<string, unknown> = {};
    if (email && emailColumn) data[emailColumn.id] = email;
    if (lead.phone && phoneColumn) data[phoneColumn.id] = lead.phone;
    const meta: CellMeta = { by: "agent", at: input.now.toISOString(), runId: input.runId };
    const [row] = await tx
      .insert(prospects)
      .values({
        orgId: input.orgId,
        projectId: base.projectId,
        baseId: base.id,
        agentConfigId: input.agentConfigId,
        runId: input.runId,
        dedupeKey: `lead:${email ?? phone}`,
        companyName: lead.companyName || person || email || lead.phone || "(sin nombre)",
        personName: base.rowKind === "person" ? person || email || lead.phone : null,
        data,
        cellMeta: Object.fromEntries(Object.keys(data).map((id) => [id, meta])),
      })
      .onConflictDoNothing({ target: [prospects.baseId, prospects.dedupeKey] })
      .returning({ id: prospects.id });
    rowId = row?.id;
  }
  if (!rowId) return null;
  await tx
    .update(contacts)
    .set({
      data: sql`${contacts.data} || ${JSON.stringify({ prospect: { baseId: base.id, rowId } })}::jsonb`,
    })
    .where(and(eq(contacts.id, input.contactId), sql`${contacts.data}->'prospect' is null`));
  return rowId;
}
