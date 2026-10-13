import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrg } from "../../../tests/helpers/db";
import { listInbox } from "../conversations/inbox";
import type { Db } from "../db/client";
import { conversations, projectMembers, user } from "../db/schema";
import { withSystem, withTenant, type TenantContext } from "../db/tenant";
import {
  canSee,
  projectPeople,
  setInvitationProjects,
  setMemberProjects,
  setProjectPeople,
  visibleProjectIds,
} from "./access";
import { createProject } from "./projects";
import { acceptInvitation, changeMemberRole, inviteMember, listTeam, removeMember } from "./team";

let db: Db;
let close: () => Promise<void>;
let owner: TenantContext & { userId: string; role: "owner" };

async function newUser(email: string) {
  const id = randomUUID();
  await withSystem(db, (tx) => tx.insert(user).values({ id, name: email.split("@")[0], email }));
  return { id, email };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Swipoo");
  owner = {
    orgId: seeded.orgId,
    actorType: "user",
    actorId: seeded.userId,
    userId: seeded.userId,
    role: "owner",
  };
});
afterAll(async () => close());

describe("project sharing", () => {
  it("shows a member only the projects shared with them; admins see all", async () => {
    const andalucia = await createProject(db, owner, { name: "Andalucía" });
    const madrid = await createProject(db, owner, { name: "Madrid" });

    // Invited as a member with one project: it's theirs when they join.
    const adrian = await newUser("adrian@swipoo.com");
    const invite = await inviteMember(db, owner, { email: adrian.email, role: "member" });
    await setInvitationProjects(db, owner.orgId, invite, [andalucia.id]);
    await acceptInvitation(db, adrian, invite);
    const asAdrian = { orgId: owner.orgId, userId: adrian.id, role: "member" };
    expect(await visibleProjectIds(db, asAdrian)).toEqual([andalucia.id]);
    expect(await visibleProjectIds(db, owner)).toBeNull();
    expect(canSee([andalucia.id], madrid.id)).toBe(false);
    // Tables without a project are the organization's.
    expect(canSee([andalucia.id], null)).toBe(true);

    // Shared from the project: admins are not listed as shares, they see it anyway.
    const ana = await newUser("ana@swipoo.com");
    await acceptInvitation(db, ana, await inviteMember(db, owner, { email: ana.email, role: "admin" }));
    expect(await setProjectPeople(db, owner, madrid.id, [adrian.id, ana.id])).toBe(1);
    const people = await projectPeople(db, owner.orgId, madrid.id);
    expect(people.find((p) => p.userId === ana.id)?.access).toBe(true);
    expect((await visibleProjectIds(db, asAdrian))?.sort()).toEqual([andalucia.id, madrid.id].sort());

    // From the person: exactly these projects.
    await setMemberProjects(db, owner, adrian.id, [madrid.id]);
    expect(await visibleProjectIds(db, asAdrian)).toEqual([madrid.id]);
    await expect(
      setMemberProjects(db, { ...owner, role: "member" }, adrian.id, [andalucia.id]),
    ).rejects.toThrow(/administra/);

    // Their inbox only has the conversations of their projects.
    await withTenant(db, owner, (tx) =>
      tx.insert(conversations).values([
        { orgId: owner.orgId, projectId: andalucia.id, channel: "email", status: "open" },
        { orgId: owner.orgId, projectId: madrid.id, channel: "email", status: "open" },
      ] as never),
    );
    const visible = await visibleProjectIds(db, asAdrian);
    const inbox = await listInbox(
      db,
      { orgId: owner.orgId, userId: adrian.id },
      { box: "all", projectIds: visible },
    );
    expect(inbox.rows.map((r) => r.projectId)).toEqual([madrid.id]);
    expect(
      (await listInbox(db, { orgId: owner.orgId, userId: adrian.id }, { box: "all", projectIds: [] })).rows,
    ).toEqual([]);

    // Leaving the organization takes the shares with them.
    const { members } = await listTeam(db, owner.orgId);
    const adrianMember = members.find((m) => m.userId === adrian.id)!;
    await changeMemberRole(db, owner, adrianMember.id, "member");
    await removeMember(db, owner, adrianMember.id);
    const left = await withTenant(db, owner, (tx) => tx.select().from(projectMembers));
    expect(left.some((r) => r.userId === adrian.id)).toBe(false);
  });
});
