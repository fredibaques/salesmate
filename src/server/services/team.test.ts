import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import type { Db } from "../db/client";
import { auditLog, user } from "../db/schema";
import { withSystem, withTenant } from "../db/tenant";
import {
  acceptInvitation,
  cancelInvitation,
  changeMemberRole,
  getInvitation,
  invitationsFor,
  inviteMember,
  listTeam,
  removeMember,
  type TeamActor,
} from "./team";

let db: Db;
let close: () => Promise<void>;
let owner: TeamActor;

async function newUser(email: string) {
  const id = randomUUID();
  await withSystem(db, (tx) => tx.insert(user).values({ id, name: email.split("@")[0], email }));
  return { id, email };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Equipo");
  owner = { orgId: seeded.orgId, userId: seeded.userId, role: "owner" };
});
afterAll(async () => close());

describe("team", () => {
  it("invites by link, and the invited person joins with the role", async () => {
    const id = await inviteMember(db, owner, { email: " Ana@Motorsur.es ", role: "admin" });
    expect(await getInvitation(db, id)).toMatchObject({
      email: "ana@motorsur.es",
      role: "admin",
      organizationName: "Equipo",
      problem: null,
    });
    // Inviting again gives a fresh link and voids the old one.
    const again = await inviteMember(db, owner, { email: "ana@motorsur.es", role: "member" });
    expect((await getInvitation(db, id))?.problem).toBe("used");
    expect((await listTeam(db, owner.orgId)).invitations).toEqual([
      expect.objectContaining({ id: again, role: "member" }),
    ]);

    const ana = await newUser("ana@motorsur.es");
    const other = await newUser("otra@motorsur.es");
    expect(await invitationsFor(db, "ANA@motorsur.es")).toHaveLength(1);
    await expect(acceptInvitation(db, other, again)).rejects.toThrow("ana@motorsur.es");
    expect(await acceptInvitation(db, ana, again)).toBe(owner.orgId);
    await expect(acceptInvitation(db, ana, again)).rejects.toThrow("ya no es válida");

    const team = await listTeam(db, owner.orgId);
    expect(team.members.map((m) => [m.email, m.role])).toContainEqual(["ana@motorsur.es", "member"]);
    expect(team.invitations).toEqual([]);
    await expect(inviteMember(db, owner, { email: "ana@motorsur.es", role: "member" })).rejects.toThrow(
      "ya está",
    );
    const events = await withTenant(db, owner, (tx) =>
      tx.select({ event: auditLog.event }).from(auditLog).where(eq(auditLog.orgId, owner.orgId)),
    );
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(["member.invited", "member.joined"]));
  });

  it("expires invitations and lets admins cancel them", async () => {
    const past = new Date(Date.now() - 8 * 86_400_000);
    const old = await inviteMember(db, owner, { email: "tarde@x.es", role: "member" }, past);
    expect((await getInvitation(db, old))?.problem).toBe("expired");
    const late = await newUser("tarde@x.es");
    await expect(acceptInvitation(db, late, old)).rejects.toThrow("caducado");

    const id = await inviteMember(db, owner, { email: "nadie@x.es", role: "member" });
    await cancelInvitation(db, owner, id);
    expect((await getInvitation(db, id))?.problem).toBe("used");
  });

  it("changes roles and removes people, keeping an owner and owners to owners", async () => {
    const { members } = await listTeam(db, owner.orgId);
    const me = members.find((m) => m.userId === owner.userId)!;
    const ana = members.find((m) => m.email === "ana@motorsur.es")!;

    await expect(changeMemberRole(db, owner, me.id, "admin")).rejects.toThrow("al menos un propietario");
    await changeMemberRole(db, owner, ana.id, "admin");
    const admin: TeamActor = { orgId: owner.orgId, userId: ana.userId, role: "admin" };
    await expect(changeMemberRole(db, admin, me.id, "member")).rejects.toThrow("Solo un propietario");
    await expect(inviteMember(db, admin, { email: "jefe@x.es", role: "owner" })).rejects.toThrow(
      "Solo un propietario",
    );
    const member: TeamActor = { ...admin, role: "member" };
    await expect(inviteMember(db, member, { email: "x@x.es", role: "member" })).rejects.toThrow("administra");
    await expect(removeMember(db, owner, me.id)).rejects.toThrow("a ti mismo");
    await removeMember(db, owner, ana.id);
    expect((await listTeam(db, owner.orgId)).members.map((m) => m.email)).not.toContain("ana@motorsur.es");
  });
});
