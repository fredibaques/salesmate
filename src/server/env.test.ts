import { afterEach, describe, expect, it, vi } from "vitest";
import { env, trustedOrigins } from "./env";

describe("trustedOrigins", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("trusts APP_URL and every URL Vercel serves the deployment under", () => {
    vi.stubEnv("VERCEL_URL", "salesmate-abc123-team.vercel.app");
    vi.stubEnv("VERCEL_BRANCH_URL", "salesmate-git-main-team.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "salesmate.vercel.app");
    const origins = trustedOrigins();
    expect(origins).toEqual(
      expect.arrayContaining([
        env().APP_URL,
        "https://salesmate-abc123-team.vercel.app",
        "https://salesmate-git-main-team.vercel.app",
        "https://salesmate.vercel.app",
      ]),
    );
    expect(new Set(origins).size).toBe(origins.length);
  });

  it("is just APP_URL outside Vercel", () => {
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("VERCEL_BRANCH_URL", undefined);
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", undefined);
    expect(trustedOrigins()).toEqual([env().APP_URL]);
  });
});
