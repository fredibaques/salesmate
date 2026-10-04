import { and, eq, isNotNull } from "drizzle-orm";
import { identities, meetingTypes, projects } from "../db/schema";
import { withTenant } from "../db/tenant";
import { openConnection, type ConnectorDeps } from "../connectors/service";
import { computeSlots, type Interval } from "./slots";

export type Availability = {
  slots: Interval[];
  /** Calendars that could not be read; the slots may be optimistic for them. */
  warnings: string[];
};

/**
 * Availability of a meeting type's host. Busy time comes from every calendar
 * identity the host owns in the organization, regardless of project, because
 * a person has one agenda even when they sell for several projects.
 */
export async function getAvailability(
  deps: ConnectorDeps & { now?: () => Date },
  tenant: { orgId: string },
  meetingTypeId: string,
): Promise<Availability> {
  const now = deps.now?.() ?? new Date();
  const { meetingType, project, calendars } = await withTenant(deps.db, tenant, async (tx) => {
    const [meetingType] = await tx.select().from(meetingTypes).where(eq(meetingTypes.id, meetingTypeId));
    if (!meetingType) throw new Error("Tipo de reunión no encontrado.");
    const [project] = await tx.select().from(projects).where(eq(projects.id, meetingType.projectId));
    const calendars = meetingType.hostUserId
      ? await tx
          .select()
          .from(identities)
          .where(
            and(
              eq(identities.kind, "calendar"),
              eq(identities.ownerUserId, meetingType.hostUserId),
              isNotNull(identities.connectionId),
            ),
          )
      : [];
    return { meetingType, project, calendars };
  });

  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + (meetingType.horizonDays + 1) * 86_400_000).toISOString();
  const busy: Interval[] = [];
  const warnings: string[] = [];
  if (calendars.length === 0) warnings.push("El anfitrión no tiene calendarios conectados.");

  const byConnection = new Map<string, string[]>();
  for (const c of calendars) {
    byConnection.set(c.connectionId!, [...(byConnection.get(c.connectionId!) ?? []), c.address]);
  }
  for (const [connectionId, calendarIds] of byConnection) {
    try {
      const { client } = await openConnection(deps, tenant, connectionId);
      if (!client["calendar.free_busy"]) {
        warnings.push(`La conexión de ${calendarIds.join(", ")} no permite leer disponibilidad.`);
        continue;
      }
      const result = await client["calendar.free_busy"]({ calendarIds, timeMin, timeMax });
      busy.push(...result.busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })));
      warnings.push(...result.errors);
    } catch (err) {
      warnings.push(`${calendarIds.join(", ")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const slots = computeSlots(
    {
      weeklyHours: meetingType.weeklyHours,
      timezone: meetingType.timezone ?? project.timezone,
      durationMinutes: meetingType.durationMinutes,
      bufferBeforeMinutes: meetingType.bufferBeforeMinutes,
      bufferAfterMinutes: meetingType.bufferAfterMinutes,
      minNoticeMinutes: meetingType.minNoticeMinutes,
      horizonDays: meetingType.horizonDays,
      stepMinutes: meetingType.slotStepMinutes,
    },
    busy,
    now,
  );
  return { slots, warnings };
}
