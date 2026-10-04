import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import type { TenantContext } from "../db/tenant";
import {
  addSuppression,
  createMeetingType,
  createProject,
  getProjectRules,
  listProjects,
  normalizeSuppression,
  setProjectState,
  updateProject,
} from "./projects";

let db: Db;
let close: () => Promise<void>;
let tenant: TenantContext;
let userId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Svc");
  userId = seeded.userId;
  tenant = { orgId: seeded.orgId, actorType: "user", actorId: userId };
});

afterAll(async () => close());

describe("projects service", () => {
  it("creates a project with every agent disabled in draft mode", async () => {
    const project = await createProject(db, tenant, { name: "Consultoría" });
    const rules = await getProjectRules(db, tenant, project.id);
    expect(rules.agents).toHaveLength(5);
    expect(rules.agents.every((a) => !a.enabled && a.autonomy.default === 1)).toBe(true);
  });

  it("validates time zones and merges settings", async () => {
    await expect(createProject(db, tenant, { name: "Mal", timezone: "Mars/Olympus" })).rejects.toThrow(
      /Zona horaria/,
    );
    const project = await createProject(db, tenant, { name: "Ajustes" });
    await updateProject(db, tenant, project.id, {
      name: "Ajustes",
      settings: { sendWindow: ["09:00", "18:00"] },
    });
    const updated = await updateProject(db, tenant, project.id, {
      name: "Ajustes",
      settings: { crossProjectCooldownDays: 7 },
    });
    expect(updated.settings).toEqual({ sendWindow: ["09:00", "18:00"], crossProjectCooldownDays: 7 });
  });

  it("toggles the kill switch", async () => {
    const project = await createProject(db, tenant, { name: "Pausa" });
    await setProjectState(db, tenant, project.id, { agentsPaused: true });
    const listed = (await listProjects(db, tenant)).find((p) => p.id === project.id);
    expect(listed?.agentsPaused).toBe(true);
  });

  it("normalizes suppressions and ignores duplicates", async () => {
    expect(normalizeSuppression("domain", "https://www.Acme.com/contacto")).toBe("acme.com");
    expect(normalizeSuppression("phone", "+34 600 11 22 33")).toBe("+34600112233");
    expect(() => normalizeSuppression("email", "no-es-email")).toThrow();
    const first = await addSuppression(db, tenant, {
      projectId: null,
      type: "email",
      value: "Baja@Cliente.com",
    });
    const again = await addSuppression(db, tenant, {
      projectId: null,
      type: "email",
      value: "baja@cliente.com",
    });
    expect(first?.value).toBe("baja@cliente.com");
    expect(again).toBeNull();
  });

  it("builds weekly hours for meeting types", async () => {
    const project = await createProject(db, tenant, { name: "Reuniones" });
    const meetingType = await createMeetingType(db, tenant, project.id, {
      name: "Demo",
      kind: "demo",
      durationMinutes: 30,
      days: ["mon", "wed"],
      from: "09:00",
      to: "13:00",
      hostUserId: userId,
    });
    expect(meetingType.weeklyHours).toEqual({ mon: [["09:00", "13:00"]], wed: [["09:00", "13:00"]] });
    await expect(
      createMeetingType(db, tenant, project.id, {
        name: "Mal",
        kind: "demo",
        durationMinutes: 30,
        days: ["mon"],
        from: "14:00",
        to: "09:00",
        hostUserId: userId,
      }),
    ).rejects.toThrow(/anterior/);
  });
});
