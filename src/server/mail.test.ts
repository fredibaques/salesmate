import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, seedOrg } from "../../tests/helpers/db";
import { mockFetch } from "../../tests/helpers/fetch";
import type { Db } from "./db/client";
import { emailInvitation, inviteMember } from "./services/team";

// Set before anything reads the environment (it's read once).
vi.stubEnv("RESEND_API_KEY", "re_test_key");
vi.stubEnv("EMAIL_FROM", "SalesMate <hola@salesmate.test>");

let db: Db;
let close: () => Promise<void>;
let actor: { orgId: string; userId: string; role: "owner"; name: string; organizationName: string };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const seeded = await seedOrg(db, "Swipoo");
  actor = {
    orgId: seeded.orgId,
    userId: seeded.userId,
    role: "owner",
    name: "Fredi",
    organizationName: "Swipoo",
  };
});
afterAll(async () => close());

describe("invitation emails", () => {
  it("sends the invitation link through Resend, and says why when it can't", async () => {
    const id = await inviteMember(db, actor, { email: "adrian@swipoo.com", role: "member" });
    const { fetch, requests } = mockFetch({ "POST https://api.resend.com/emails": () => ({ id: "em_1" }) });
    expect(await emailInvitation(db, actor, id, { appUrl: "https://app.test", fetch })).toBe(
      "adrian@swipoo.com",
    );
    expect(requests[0].headers.authorization).toBe("Bearer re_test_key");
    const body = requests[0].body as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    expect(body).toMatchObject({
      from: "SalesMate <hola@salesmate.test>",
      to: ["adrian@swipoo.com"],
      subject: "Fredi te invita a Swipoo en SalesMate",
    });
    expect(body.text).toContain(`https://app.test/invite/${id}`);
    expect(body.html).toContain(`https://app.test/invite/${id}`);

    const { fetch: refused } = mockFetch({
      "POST https://api.resend.com/emails": () =>
        new Response(JSON.stringify({ message: "The domain is not verified." }), { status: 403 }),
    });
    await expect(
      emailInvitation(db, actor, id, { appUrl: "https://app.test", fetch: refused }),
    ).rejects.toThrow("The domain is not verified.");
    // Only people who manage the organization send invitations.
    await expect(
      emailInvitation(db, { ...actor, role: "member" as never }, id, { appUrl: "https://app.test", fetch }),
    ).rejects.toThrow(/administra/);
  });
});
